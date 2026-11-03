import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { APP_NAME } from './constants';
import { validateLateGraceMinutes } from '../lib/attendancePolicy';

// Projects live at `CMG-Payroll/root/projects/{projectId}`, the same layer as
// `users`. A user only sees the projects a MasterAdmin assigned to them.
export const projectsCollection = () => collection(db, APP_NAME, 'root', 'projects');
export const projectDocRef = (projectId) => doc(projectsCollection(), projectId);

export const PROJECT_STATUSES = ['Active', 'Disable'];
// Projects without a status (created before statuses existed) count as Active.
export const isProjectEnabled = (project) => project.status !== 'Disable';

const toProject = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th');

// MasterAdmin lists the whole collection.
export const subscribeToAllProjects = ({ onData, onError }) => onSnapshot(
  projectsCollection(),
  (snapshot) => onData(snapshot.docs.map(toProject).filter((project) => !project.archived).sort(byName)),
  (error) => onError?.(error),
);

// Everyone else listens to each assigned project document individually, which
// keeps Firestore Rules simple (a `get`, never a collection `list`).
export const subscribeToProjectIds = (projectIds, { onData, onError }) => {
  const found = new Map();
  const emit = () => onData([...found.values()].filter((project) => !project.archived).sort(byName));
  if (!projectIds.length) {
    onData([]);
    return () => {};
  }
  const unsubscribers = projectIds.map((projectId) => onSnapshot(
    projectDocRef(projectId),
    (snapshot) => {
      if (snapshot.exists()) found.set(projectId, toProject(snapshot));
      else found.delete(projectId);
      emit();
    },
    (error) => {
      found.delete(projectId);
      emit();
      onError?.(error);
    },
  ));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
};

export const createProject = async ({ name, code = '', description = '', lateGraceMinutes = 10 }, creator) => {
  const ref = doc(projectsCollection());
  const now = Timestamp.now();
  await setDoc(ref, {
    name: String(name).trim(),
    code: String(code).trim(),
    description: String(description).trim(),
    lateGraceMinutes: validateLateGraceMinutes(lateGraceMinutes),
    archived: false,
    status: 'Active',
    createdAt: now,
    updatedAt: now,
    createdBy: creator?.email || '',
  });
  return ref.id;
};

// Only the changed fields are written so concurrent edits do not clobber each other.
export const updateProject = (projectId, changes) => updateDoc(projectDocRef(projectId), {
  ...changes,
  ...('lateGraceMinutes' in changes ? { lateGraceMinutes: validateLateGraceMinutes(changes.lateGraceMinutes) } : {}),
  updatedAt: Timestamp.now(),
});

// Archiving hides a project without deleting its data.
export const archiveProject = (projectId) => updateProject(projectId, { archived: true });

// ----------------------------------------------------- from rates (Refresh) -----

const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Stable id so the same project name always maps to the same document.
const projectIdForName = (name) => {
  let hash = 2166136261;
  for (const char of nameKey(name)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return `rates-${hash.toString(16).padStart(8, '0')}`;
};

// The rates `project` field is a list joined with ", " (see syncMasterEmployees).
const uniqueRateProjectNames = (rateRows) => {
  const names = new Map();
  rateRows.forEach((row) => String(row.project || '').split(/\s*,\s*/).forEach((part) => {
    const name = part.trim().replace(/\s+/g, ' ');
    if (name && !names.has(nameKey(name))) names.set(nameKey(name), name);
  }));
  return [...names.values()];
};

// Names present in the rates but not yet stored as a project.
export const pendingProjectNames = (rateRows, projects) => {
  const known = new Set(projects.map((project) => nameKey(project.name)));
  return uniqueRateProjectNames(rateRows).filter((name) => !known.has(nameKey(name)));
};

// Only ever adds: existing projects (even ones no employee uses any more) are
// never changed or deleted. Returns how many were added.
export const addProjectsFromRates = async (rateRows, creator) => {
  // Read every stored project (including archived ones) so none is re-added.
  const stored = (await getDocs(projectsCollection())).docs.map(toProject);
  const names = pendingProjectNames(rateRows, stored);
  const now = Timestamp.now();
  for (let start = 0; start < names.length; start += 400) {
    const batch = writeBatch(db);
    names.slice(start, start + 400).forEach((name) => batch.set(projectDocRef(projectIdForName(name)), {
      name,
      code: '',
      description: '',
      lateGraceMinutes: 10,
      archived: false,
      status: 'Active',
      source: 'rates',
      createdAt: now,
      updatedAt: now,
      createdBy: creator?.email || '',
    }));
    await batch.commit();
  }
  return names.length;
};

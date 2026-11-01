import { Timestamp, collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, ensureFirebaseReady, isFirebaseConfigured } from './firebase';
import { FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT } from './repository';

// Work-shift profiles live under their project: CMG-Payroll/root/projects/{projectId}/shifts/{shiftId}.
// They inherit the project Firestore Rules (assigned users read, MasterAdmin writes).
// A project has at most one default shift; employees without an explicit assignment use it.
const shiftsCollection = (projectId) => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, 'projects', projectId, 'shifts');

const byStart = (a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.name).localeCompare(String(b.name), 'th');

export function subscribeToShifts({ projectId, onData, onError }) {
  if (!isFirebaseConfigured || !projectId) { onData([]); return () => {}; }
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      shiftsCollection(projectId),
      (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort(byStart)),
      onError,
    );
  }).catch(onError);
  return () => { cancelled = true; unsubscribe(); };
}

const normalizeShift = ({ name, startTime, endTime, note = '' }) => ({ name: name.trim(), startTime, endTime, note: note.trim() });

// The first shift of a project becomes its default automatically.
export async function saveShift({ projectId, shift, id, makeDefault = false }) {
  const values = normalizeShift(shift);
  const now = Timestamp.now();
  if (id) {
    await updateDoc(doc(shiftsCollection(projectId), id), { ...values, projectId, updatedAt: now });
    return id;
  }
  const ref = doc(shiftsCollection(projectId));
  await setDoc(ref, { ...values, projectId, isDefault: Boolean(makeDefault), createdAt: now, updatedAt: now });
  return ref.id;
}

// Exactly one default per project: clear the others in the same batch.
export async function setDefaultShift({ projectId, shifts, shiftId }) {
  const batch = writeBatch(db);
  shifts.forEach((shift) => {
    const shouldBeDefault = shift.id === shiftId;
    if (Boolean(shift.isDefault) !== shouldBeDefault) batch.update(doc(shiftsCollection(projectId), shift.id), { isDefault: shouldBeDefault, updatedAt: Timestamp.now() });
  });
  await batch.commit();
}

// Removes the shift together with every ตั้งกะการทำงาน range that uses it.
export async function deleteShift({ projectId, shiftId }) {
  const assigned = await getDocs(query(assignmentsCollection(projectId), where('shiftId', '==', shiftId)));
  for (let index = 0; index < assigned.docs.length; index += 400) {
    const batch = writeBatch(db);
    assigned.docs.slice(index, index + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await deleteDoc(doc(shiftsCollection(projectId), shiftId));
}

// Hours between start and end, wrapping past midnight for night shifts.
export function shiftHours(startTime, endTime) {
  const toMinutes = (time) => { const [h, m] = String(time || '').split(':').map(Number); return h * 60 + m; };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return (((end - start) % 1440) + 1440) % 1440 / 60;
}

// ---------------------------------------------------------- assignments -----
// ตั้งกะการทำงาน: CMG-Payroll/root/projects/{projectId}/shiftAssignments/{id}, one document per
// employee per date range ({ shiftId, employeeId, employeeName, position, department, startDate, endDate }
// with ISO YYYY-MM-DD dates, both inclusive). An employee may never have two ranges sharing a day.
const assignmentsCollection = (projectId) => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, 'projects', projectId, 'shiftAssignments');

export function subscribeToShiftAssignments({ projectId, onData, onError }) {
  if (!isFirebaseConfigured || !projectId) { onData([]); return () => {}; }
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      assignmentsCollection(projectId),
      (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, projectId, ...item.data() }))),
      onError,
    );
  }).catch(onError);
  return () => { cancelled = true; unsubscribe(); };
}

export const employeeKey = (value) => String(value || '').trim().toLowerCase();
export const rangesOverlap = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

// Existing assignments of `employeeId` that share a day with [startDate, endDate], ignoring `exceptId`.
export const findConflicts = (assignments, { employeeId, startDate, endDate, exceptId }) => assignments.filter((item) => (
  item.id !== exceptId && employeeKey(item.employeeId) === employeeKey(employeeId) && rangesOverlap(item, { startDate, endDate })
));

export async function addShiftAssignments({ projectId, shiftId, employees, startDate, endDate }) {
  const now = Timestamp.now();
  for (let index = 0; index < employees.length; index += 400) {
    const batch = writeBatch(db);
    employees.slice(index, index + 400).forEach((employee) => batch.set(doc(assignmentsCollection(projectId)), {
      projectId, shiftId, startDate, endDate,
      employeeId: String(employee.employeeId || '').trim(),
      employeeName: employee.name,
      position: employee.position || '',
      department: employee.department || '',
      createdAt: now,
      updatedAt: now,
    }));
    await batch.commit();
  }
}

export const updateShiftAssignment = ({ projectId, id, startDate, endDate }) => updateDoc(doc(assignmentsCollection(projectId), id), { startDate, endDate, updatedAt: Timestamp.now() });
export const deleteShiftAssignment = ({ projectId, id }) => deleteDoc(doc(assignmentsCollection(projectId), id));

// Shift to use for an employee: the explicitly assigned one, otherwise the project default.
export const resolveEmployeeShift = (shifts, assignedShiftId) => (
  shifts.find((shift) => shift.id === assignedShiftId) || shifts.find((shift) => shift.isDefault) || null
);

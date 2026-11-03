import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL as getStorageDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  db,
  ensureFirebaseReady,
  ensureMasterDatabaseReady,
  isFirebaseConfigured,
  isMasterDatabaseConfigured,
  masterDb,
  storage,
} from './firebase';
import { mockDatasets } from '../data/mockData';

export const FIREBASE_ROOT_COLLECTION = 'CMG-Payroll';
export const FIREBASE_ROOT_DOCUMENT = 'root';
export const MASTER_DATABASE_EMPLOYEE_PATH = 'CMG-HR-Database/root/employee_data';
export const SPECIAL_POSITION_OPTIONS_DOCUMENT = 'special-position-options';
export const COLUMN_SETTINGS_DOCUMENT = 'column-settings';
export const PAYROLL_PERIODS_COLLECTION = 'payrollPeriods';
export const DELETED_PAYROLL_PERIODS_COLLECTION = 'deletedPayrollPeriods';
export const PAYROLL_SAVEDRAFT_STATUS = 'Savedraft';
const PAYROLL_DELETED_PERIOD_STORAGE_KEY = 'cmg-payroll-deleted-periods-v1';
const PAYROLL_REVISION_STORAGE_KEY = 'cmg-payroll-revisions-v1';
const PAYROLL_PERIOD_LIST_STORAGE_KEY = 'cmg-payroll-period-list-v1';

const REVISION_ROWS_PER_CHUNK = 100;
const REVISION_SAVE_TIMEOUT_MS = 30000;

// Firestore writes wait for the server forever when the connection stalls, so
// surface that as an error instead of leaving the dialog on "saving".
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error('Firestore write timed out');
    error.code = 'timeout';
    reject(error);
  }, ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

const WORKING_STATUS ='ทำงาน';
const MASTER_EMPLOYEE_FIELDS = ['employeeId', 'firstName', 'lastName', 'department', 'teamName', 'position', 'project', 'employeeStatus'];

const fieldAliases = {
  employeeId: ['employeeId', 'employee_id', 'employeeCode', 'employee_code', 'code', 'รหัสพนักงาน', 'รหัสพนักงาน '],
  firstName: ['firstName', 'first_name', 'firstname', 'name', 'ชื่อ', 'ชื่อจริง', 'ชื่อตัว'],
  lastName: ['lastName', 'last_name', 'lastname', 'นามสกุล', 'ชื่อสกุล'],
  department: ['department', 'dept', 'แผนก'],
  teamName: ['teamName', 'team_name', 'team', 'ชื่อชุด', 'ชุด'],
  position: ['position', 'jobTitle', 'job_title', 'title', 'ตำแหน่ง'],
  project: ['สถานะโครงการ', 'project'],
  employeeStatus: ['สถานะพนักงาน', 'employeeStatus'],
};

const textFromValue = (value) => (Array.isArray(value)
  ? value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
  : String(value ?? '').trim());

const unwrapValue = (value) => {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  return value;
};

const valueFromAliases = (record, aliases) => {
  for (const alias of aliases) {
    if (record && Object.prototype.hasOwnProperty.call(record, alias)) {
      const value = unwrapValue(record[alias]);
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
  }
  return '';
};

const normalizeMasterEmployee = (record, fallbackEmployeeId = '') => {
  const source = record && typeof record === 'object' ? record : {};
  const employeeId = valueFromAliases(source, fieldAliases.employeeId) || fallbackEmployeeId;
  if (employeeId === null || employeeId === undefined || String(employeeId).trim() === '') return null;

  return MASTER_EMPLOYEE_FIELDS.reduce((employee, field) => {
    employee[field] = textFromValue(field === 'employeeId'
      ? employeeId
      : valueFromAliases(source, fieldAliases[field]));
    return employee;
  }, {});
};

const parseMasterEmployees = (documents) => {
  const records = documents
    .map((item) => normalizeMasterEmployee(item.data(), item.id))
    .filter(Boolean);

  // Keep one row per employee so a repeated Sync does not create duplicates.
  return [...new Map(records.map((employee) => [employee.employeeId, employee])).values()];
};

const normalizedKey = (value) => String(value || '').trim().toLowerCase();

// DC tab takes DC and Intern codes, SUPPLY tab takes SP codes. Any other
// prefix is not part of the rate tables.
const sheetForEmployeeId = (employeeId) => {
  if (/^sp/i.test(employeeId)) return 'SUPPLY';
  if (/^(?:dc|intern)/i.test(employeeId)) return 'DC';
  return null;
};

export const isRowVisible = (row) => !row.employeeStatus || row.employeeStatus === WORKING_STATUS;

const masterRecordId = (sheet, employeeId) => `master-${sheet.toLowerCase()}-${String(employeeId)
  .trim()
  .replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const chunks = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

const sortRows = (rows) => [...rows].sort((a, b) => {
  if (a.sequence !== undefined || b.sequence !== undefined) return Number(a.sequence || 0) - Number(b.sequence || 0);
  return String(a.employeeId || '').localeCompare(String(b.employeeId || ''));
});

// Rates, payroll and their settings are shared data: they do not belong to a project.
const rootCollection = (name) => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, name);

const categoryCollection = (category) => rootCollection(category);
const settingsCollection = () => rootCollection('settings');
const payrollPeriodsCollection = () => rootCollection(PAYROLL_PERIODS_COLLECTION);
const deletedPayrollPeriodsCollection = () => rootCollection(DELETED_PAYROLL_PERIODS_COLLECTION);
const readLocalDeletedPayrollPeriods = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PAYROLL_DELETED_PERIOD_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const payrollRevisionsCollection =(periodId) => collection(payrollPeriodsCollection(), periodId, 'revisions');
const payrollRevisionRowsCollection = (periodId, revisionId) => collection(payrollRevisionsCollection(periodId), revisionId, 'rows');

const revisionRowDocumentId = (row, index) => {
  const key = [row.sheet, row.employeeId || row.id || row.sequence || index]
    .map((value) => String(value ?? '').trim())
    .join('-')
    .replace(/[^a-zA-Z0-9_-ก-๙]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return key || `row-${index + 1}`;
};

const readLocalPayrollRevisions = () => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = window.localStorage.getItem(PAYROLL_REVISION_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeLocalPayrollRevisions = (revisions) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAYROLL_REVISION_STORAGE_KEY, JSON.stringify(revisions));
  } catch {
    // Local storage is only the demo-mode fallback; Firebase remains the source of truth.
  }
};

const sortPayrollRevisions = (revisions) => [...revisions].sort((a, b) => (
  String(b.savedAt || b.updatedAt || '').localeCompare(String(a.savedAt || a.updatedAt || ''))
));

const normalizeSpecialPositionOptions = (options) => [...new Set((Array.isArray(options) ? options : [])
  .map((value) => String(value ?? '').trim())
  .filter(Boolean))];

export const subscribeToSpecialPositionOptions = ({ onData, onError }) => {
  if (!isFirebaseConfigured) {
    onData?.(null);
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  const startSubscription = async () => {
    await ensureFirebaseReady();
    if (cancelled) return;

    const settingsRef = doc(settingsCollection(), SPECIAL_POSITION_OPTIONS_DOCUMENT);
    unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => onData?.(snapshot.exists() ? normalizeSpecialPositionOptions(snapshot.data()?.options) : null),
      (error) => {
        console.error('ไม่สามารถอ่านตัวเลือกค่าตำแหน่งพิเศษจาก Firebase', error);
        onError?.(error);
      },
    );
  };

  startSubscription().catch((error) => {
    console.error('ไม่สามารถเริ่มอ่านตัวเลือกค่าตำแหน่งพิเศษจาก Firebase', error);
    onError?.(error);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

export const saveSpecialPositionOptions = async (options = []) => {
  const normalizedOptions = normalizeSpecialPositionOptions(options);
  if (!isFirebaseConfigured) return normalizedOptions;

  await ensureFirebaseReady();
  await setDoc(doc(settingsCollection(), SPECIAL_POSITION_OPTIONS_DOCUMENT), {
    options: normalizedOptions,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return normalizedOptions;
};

const normalizeColumnSettingsMap = (settings) => (settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {});

export const subscribeToColumnSettings = ({ onData, onError }) => {
  if (!isFirebaseConfigured) {
    onData?.(null);
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      doc(settingsCollection(), COLUMN_SETTINGS_DOCUMENT),
      (snapshot) => onData?.(snapshot.exists() ? normalizeColumnSettingsMap(snapshot.data()?.tables) : null),
      (error) => {
        console.error('ไม่สามารถอ่านการตั้งค่าคอลัมน์จาก Firebase', error);
        onError?.(error);
      },
    );
  }).catch((error) => {
    console.error('ไม่สามารถเริ่มอ่านการตั้งค่าคอลัมน์จาก Firebase', error);
    onError?.(error);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

export const saveColumnSettings = async (tables = {}) => {
  const normalized = normalizeColumnSettingsMap(tables);
  if (!isFirebaseConfigured) return normalized;

  await ensureFirebaseReady();
  await setDoc(doc(settingsCollection(), COLUMN_SETTINGS_DOCUMENT), {
    tables: normalized,
    updatedAt: new Date().toISOString(),
  });
  return normalized;
};

const safeFileName =(name) => name.replace(/[^a-zA-Z0-9._-ก-๙]/g, '_');

const uploadAttachments = async ({ category, sheet, recordId, files }) => {
  if (!files?.length || !storage) return [];

  return Promise.all(files.map(async (file) => {
    const path = `${FIREBASE_ROOT_COLLECTION}/${FIREBASE_ROOT_DOCUMENT}/${category}/${sheet}/${recordId}/${Date.now()}-${safeFileName(file.name)}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
    const url = await getStorageDownloadURL(fileRef);
    return {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      path,
      url,
      uploadedAt: new Date().toISOString(),
    };
  }));
};

// Reuse the existing attachment storage layout for wage request evidence.
export const uploadWageAttachments = async (files) => {
  if (!isFirebaseConfigured) throw new Error('ยังไม่ได้ตั้งค่า Firebase จึงแนบไฟล์ไม่ได้');
  await ensureFirebaseReady();
  return uploadAttachments({ category: 'payroll', sheet: 'wageRequests', recordId: crypto.randomUUID(), files });
};

export const subscribeToDataset = ({ category, sheet, onData, onError }) => {
  if (!isFirebaseConfigured) {
    onData(sortRows(mockDatasets[category]?.[sheet] || []));
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  const startSubscription = async () => {
    await ensureFirebaseReady();
    if (cancelled) return;

    const datasetQuery = query(categoryCollection(category), where('sheet', '==', sheet));
    unsubscribe = onSnapshot(
      datasetQuery,
      (snapshot) => onData(sortRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))),
      (error) => {
        console.error(`ไม่สามารถอ่านข้อมูล ${category}/${sheet} จาก Firebase`, error);
        onError?.(error);
        onData(sortRows(mockDatasets[category]?.[sheet] || []));
      },
    );
  };

  startSubscription().catch((error) => {
    console.error(`ไม่สามารถเริ่มอ่านข้อมูล ${category}/${sheet} จาก Firebase`, error);
    onError?.(error);
    onData(sortRows(mockDatasets[category]?.[sheet] || []));
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

// Saving an existing record is optimistic: when `expectedUpdatedAt` is given and
// the stored record was changed by someone else in the meantime, nothing is
// written and a `conflict` error carrying the latest record is thrown so the
// editor can merge instead of silently overwriting the other person's work.
export const saveDatasetRecord = async ({ category, sheet, record, files = [], expectedUpdatedAt, force = false }) => {
  const payload = { ...record, sheet, updatedAt: new Date().toISOString() };
  delete payload.id;
  delete payload.files;

  if (!isFirebaseConfigured) {
    return { id: record.id || `${category}-${sheet}-${Date.now()}`, ...payload };
  }

  await ensureFirebaseReady();

  if (record.id) {
    const recordRef = doc(categoryCollection(category), record.id);
    const attachments = await uploadAttachments({ category, sheet, recordId: record.id, files });
    delete payload.attachments;

    const saved = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(recordRef);
      const latest = snapshot.exists() ? snapshot.data() : null;
      if (!force && expectedUpdatedAt !== undefined && latest && String(latest.updatedAt || '') !== String(expectedUpdatedAt || '')) {
        const error = new Error('ข้อมูลถูกแก้ไขโดยผู้อื่น');
        error.code = 'conflict';
        error.latest = { id: record.id, ...latest };
        throw error;
      }
      const next = { ...payload };
      // Attachments are merged with whatever is stored now, never replaced.
      if (attachments.length) next.attachments = [...(latest?.attachments || []), ...attachments];
      transaction.set(recordRef, next, { merge: true });
      return next;
    });
    return { id: record.id, ...record, ...saved };
  }

  const saved = doc(categoryCollection(category));
  const attachments = await uploadAttachments({ category, sheet, recordId: saved.id, files });
  if (attachments.length) {
    payload.attachments = attachments;
  }
  await setDoc(saved, payload);
  return { id: saved.id, ...payload };
};

export const subscribeToPayrollRevisions = ({ periodId, onData, onError }) => {
  if (!periodId) {
    onData?.([]);
    return () => {};
  }

  if (!isFirebaseConfigured) {
    const localRevisions = readLocalPayrollRevisions()[periodId] || [];
    onData?.(sortPayrollRevisions(localRevisions));
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  const startSubscription = async () => {
    await ensureFirebaseReady();
    if (cancelled) return;

    unsubscribe = onSnapshot(
      payrollRevisionsCollection(periodId),
      (snapshot) => onData?.(sortPayrollRevisions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))),
      (error) => {
        console.error(`ไม่สามารถอ่าน Revision ของงวด ${periodId} จาก Firebase`, error);
        onError?.(error);
      },
    );
  };

  startSubscription().catch((error) => {
    console.error(`ไม่สามารถเริ่มอ่าน Revision ของงวด ${periodId} จาก Firebase`, error);
    onError?.(error);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

const readLocalPayrollPeriods = () => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(PAYROLL_PERIOD_LIST_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const upsertLocalPayrollPeriod = (period) => {
  if (typeof window === 'undefined') return;
  try {
    const periods = readLocalPayrollPeriods().filter((item) => item.id !== period.id);
    window.localStorage.setItem(PAYROLL_PERIOD_LIST_STORAGE_KEY, JSON.stringify([{ ...period }, ...periods]));
  } catch {
    // Demo-mode fallback only.
  }
};

const sortPayrollPeriods = (periods) => [...periods].sort((a, b) => (
  String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
));

const normalizePayrollPeriod = (item) => ({
  ...item,
  id: item.id || item.periodId,
  revisionCount: Number(item.revisionCount || 0),
  rowCount: Number(item.rowCount || 0),
});

export const subscribeToPayrollPeriods = ({ onData, onError }) => {
  if (!isFirebaseConfigured) {
    onData?.(sortPayrollPeriods(readLocalPayrollPeriods().map(normalizePayrollPeriod)));
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      payrollPeriodsCollection(),
      (snapshot) => onData?.(sortPayrollPeriods(snapshot.docs.map((item) => normalizePayrollPeriod({ id: item.id, ...item.data() })))),
      (error) => {
        console.error('ไม่สามารถอ่านรายการงวดจาก Firebase', error);
        onError?.(error);
      },
    );
  }).catch((error) => {
    console.error('ไม่สามารถเริ่มอ่านรายการงวดจาก Firebase', error);
    onError?.(error);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

// Registers a period so it shows up as a card even before its first revision is saved.
export const savePayrollPeriod = async (period) => {
  const now = new Date().toISOString();
  const payload = {
    periodId: period.id,
    name: period.name,
    startDate: period.startDate || null,
    endDate: period.endDate || null,
    ...(typeof period.entryOpen === 'boolean' ? { entryOpen: period.entryOpen } : {}),
    ...(Array.isArray(period.wageEntries) ? { wageEntries: period.wageEntries } : {}),
    ...(Array.isArray(period.wageEmployees) ? { wageEmployees: period.wageEmployees } : {}),
    ...(Array.isArray(period.draftRows) ? { draftRows: period.draftRows } : {}),
    status: period.status || PAYROLL_SAVEDRAFT_STATUS,
    createdAt: period.createdAt || now,
    updatedAt: period.updatedAt || now,
  };
  if (!isFirebaseConfigured) {
    const existing = readLocalPayrollPeriods().find((item) => item.id === period.id);
    upsertLocalPayrollPeriod({ ...existing, ...payload, id: period.id });
    return payload;
  }
  await ensureFirebaseReady();
  await setDoc(doc(payrollPeriodsCollection(), period.id), payload, { merge: true });
  return payload;
};

// Loads the rows stored in a revision so a period can be re-opened with its saved numbers.
export const loadPayrollRevisionRows = async ({ periodId, revisionId }) => {
  if (!periodId || !revisionId) return [];
  if (!isFirebaseConfigured) {
    const revision = (readLocalPayrollRevisions()[periodId] || []).find((item) => item.id === revisionId);
    return revision?.rows || [];
  }
  await ensureFirebaseReady();
  const snapshot = await getDocs(payrollRevisionRowsCollection(periodId, revisionId));
  return snapshot.docs
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item) => {
      const data = item.data();
      // Chunk documents hold many rows; older revisions stored one row per document.
      const stored = Array.isArray(data.rows) ? data.rows : [data];
      return stored.map((row, index) => ({ ...row, id: row.sourceRowId || `${item.id}-${index}` }));
    });
};

export const savePayrollRevision = async ({ period, revisionName, rows = [], revisionCount = 1 }) => {
  const savedAt = new Date().toISOString();
  const revisionId = `revision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sheets = [...new Set(rows.map((row) => row.sheet).filter(Boolean))];
  const summary = {
    id: revisionId,
    periodId: period.id,
    periodName: period.name,
    revisionName: String(revisionName || '').trim() || 'ไม่มีชื่อ Revision',
    status: PAYROLL_SAVEDRAFT_STATUS,
    rowCount: rows.length,
    sheets,
    savedAt,
    updatedAt: savedAt,
  };

  if (!isFirebaseConfigured) {
    const localRevisions = readLocalPayrollRevisions();
    const periodRevisions = localRevisions[period.id] || [];
    localRevisions[period.id] = [{ ...summary, rows }, ...periodRevisions];
    writeLocalPayrollRevisions(localRevisions);
    upsertLocalPayrollPeriod({
      ...readLocalPayrollPeriods().find((item) => item.id === period.id),
      id: period.id,
      periodId: period.id,
      name: period.name,
      startDate: period.startDate || null,
      endDate: period.endDate || null,
      status: PAYROLL_SAVEDRAFT_STATUS,
      activeRevisionId: revisionId,
      revisionCount,
      rowCount: rows.length,
      createdAt: period.createdAt || savedAt,
      updatedAt: savedAt,
    });
    return summary;
  }

  await ensureFirebaseReady();
  const periodRef = doc(payrollPeriodsCollection(), period.id);
  await withTimeout(setDoc(periodRef, {
    periodId: period.id,
    name: period.name,
    startDate: period.startDate || null,
    endDate: period.endDate || null,
    status: PAYROLL_SAVEDRAFT_STATUS,
    activeRevisionId: revisionId,
    revisionCount,
    rowCount: rows.length,
    createdAt: period.createdAt || savedAt,
    updatedAt: savedAt,
  }, { merge: true }), REVISION_SAVE_TIMEOUT_MS);

  const revisionRef = doc(payrollRevisionsCollection(period.id), revisionId);
  // Rows are packed into a few chunk documents (instead of one document per
  // employee) so a whole period saves in a handful of writes.
  const rowPayloads = rows.map((row) => {
    const payload = { ...row, sourceRowId: row.id || null };
    delete payload.id;
    delete payload.attachments;
    // Firestore rejects undefined values.
    return JSON.parse(JSON.stringify(payload));
  });

  const rowsCollection = payrollRevisionRowsCollection(period.id, revisionId);
  const writeRows = async () => {
    await Promise.all(chunks(rowPayloads, REVISION_ROWS_PER_CHUNK).map((chunkRows, index) => (
      setDoc(doc(rowsCollection, `chunk-${String(index + 1).padStart(4, '0')}`), {
        periodId: period.id,
        revisionId,
        chunkIndex: index,
        rows: chunkRows,
        updatedAt: savedAt,
      })
    )));
    await setDoc(revisionRef, summary);
  };

  await withTimeout(writeRows(), REVISION_SAVE_TIMEOUT_MS);
  return summary;
};

// "Deleting" a period only hides it: its document, revisions and rows are copied
// under deletedPayrollPeriods and then removed from the live collection.
export const archivePayrollPeriod = async (period) => {
  const deletedAt = new Date().toISOString();

  if (!isFirebaseConfigured) {
    const revisions = readLocalPayrollRevisions();
    const archived = readLocalDeletedPayrollPeriods();
    archived.push({ period: readLocalPayrollPeriods().find((item) => item.id === period.id) || period, revisions: revisions[period.id] || [], deletedAt });
    delete revisions[period.id];
    writeLocalPayrollRevisions(revisions);
    try {
      window.localStorage.setItem(PAYROLL_DELETED_PERIOD_STORAGE_KEY, JSON.stringify(archived));
      window.localStorage.setItem(PAYROLL_PERIOD_LIST_STORAGE_KEY, JSON.stringify(readLocalPayrollPeriods().filter((item) => item.id !== period.id)));
    } catch {
      // Demo-mode fallback only.
    }
    return;
  }

  await ensureFirebaseReady();
  const periodRef = doc(payrollPeriodsCollection(), period.id);
  const archiveRef = doc(deletedPayrollPeriodsCollection(), period.id);
  const periodSnapshot = await getDoc(periodRef);
  const revisionSnapshot = await getDocs(collection(periodRef, 'revisions'));

  // [source ref, target ref, data] for every document that belongs to the period.
  const entries = [[periodRef, archiveRef, { ...(periodSnapshot.exists() ? periodSnapshot.data() : { periodId: period.id, name: period.name }), deletedAt }]];
  for (const revision of revisionSnapshot.docs) {
    entries.push([revision.ref, doc(collection(archiveRef, 'revisions'), revision.id), revision.data()]);
    const rowSnapshot = await getDocs(collection(revision.ref, 'rows'));
    rowSnapshot.docs.forEach((row) => entries.push([row.ref, doc(collection(doc(collection(archiveRef, 'revisions'), revision.id), 'rows'), row.id), row.data()]));
  }

  // Copy everything first so a failure never loses data, then remove the originals.
  for (const batchEntries of chunks(entries, 400)) {
    const batch = writeBatch(db);
    batchEntries.forEach(([, target, data]) => batch.set(target, data));
    await batch.commit();
  }
  for (const batchEntries of chunks([...entries].reverse(), 400)) {
    const batch = writeBatch(db);
    batchEntries.forEach(([source]) => batch.delete(source));
    await batch.commit();
  }
};

export const deleteDatasetRecord =async ({ category, record }) => {
  if (!isFirebaseConfigured) return;

  await ensureFirebaseReady();
  await deleteDoc(doc(categoryCollection(category), record.id));

  if (!storage || !record.attachments?.length) return;
  await Promise.all(record.attachments.filter((attachment) => attachment.path).map(async (attachment) => {
    try {
      await deleteObject(storageRef(storage, attachment.path));
    } catch (error) {
      console.error(`ไม่สามารถลบไฟล์แนบ ${attachment.path}`, error);
    }
  }));
};

export const syncMasterEmployees = async ({ existingRowsBySheet = {} } = {}) => {
  if (!isMasterDatabaseConfigured || !masterDb) {
    const error = new Error('ยังไม่ได้ตั้งค่า Master Database');
    error.code = 'master-database-not-configured';
    throw error;
  }
  if (!isFirebaseConfigured || !db) {
    const error = new Error('ยังไม่ได้ตั้งค่า Firebase ของระบบปลายทาง');
    error.code = 'firebase-not-configured';
    throw error;
  }

  await ensureMasterDatabaseReady();
  const snapshot = await getDocs(collection(masterDb, MASTER_DATABASE_EMPLOYEE_PATH));
  const employees = parseMasterEmployees(snapshot.docs);
  const storedRowsSnapshot = await getDocs(categoryCollection('rates'));
  const storedRows = storedRowsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const existingRows = [...storedRows, ...Object.values(existingRowsBySheet).flat()];
  const existingByEmployeeId = new Map();

  existingRows.forEach((row) => {
    const key = normalizedKey(row.employeeId);
    if (key && !existingByEmployeeId.has(key)) existingByEmployeeId.set(key, row);
  });

  const syncedRows = [];
  const changedRows = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  employees.forEach((employee) => {
    const sheet = sheetForEmployeeId(employee.employeeId);
    if (!sheet) return;

    const existing = existingByEmployeeId.get(normalizedKey(employee.employeeId));
    // Employees of every status are stored; isRowVisible hides non-working ones.

    const id = existing?.id || masterRecordId(sheet, employee.employeeId);
    const nameChangedFields = existing
      ? ['firstName', 'lastName'].filter((field) => String(existing[field] ?? '') !== employee[field])
      : [];
    const syncedRow = {
      ...(existing || {}),
      id,
      sheet,
      ...employee,
    };
    if (nameChangedFields.length) {
      syncedRow.nameChangedAt = new Date().toISOString();
      syncedRow.nameChangedFields = nameChangedFields;
    }
    const hasChanges = !existing || MASTER_EMPLOYEE_FIELDS.some((field) => String(existing[field] ?? '') !== employee[field]) || existing.sheet !== sheet;

    if (!existing) created += 1;
    else if (hasChanges) updated += 1;
    else unchanged += 1;

    if (hasChanges) {
      changedRows.push({ id, payload: { ...syncedRow, updatedAt: new Date().toISOString() } });
    }
    syncedRows.push(syncedRow);
  });

  if (changedRows.length) {
    for (const batchRows of chunks(changedRows, 450)) {
      const batch = writeBatch(db);
      batchRows.forEach(({ id, payload }) => {
        const firestorePayload = { ...payload };
        delete firestorePayload.id;
        delete firestorePayload.files;
        batch.set(doc(categoryCollection('rates'), id), firestorePayload, { merge: true });
      });
      await batch.commit();
    }
  }

  return {
    total: syncedRows.length,
    created,
    updated,
    unchanged,
    rows: syncedRows,
  };
};

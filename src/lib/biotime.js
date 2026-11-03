import { wageTimeError } from './wageTimeRequest';
import { collection, deleteField, doc, FieldPath, onSnapshot, runTransaction, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db, ensureFirebaseReady, isFirebaseConfigured } from './firebase';
import { FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, PAYROLL_PERIODS_COLLECTION } from './repository';

// Browser never sees ZKBioTime credentials: the Cloud Function (or the Vite dev
// middleware) logs in, fetches scan transactions and returns only the punches.
export async function fetchBiotimePunches({ startDate, endDate }) {
  const headers = {};
  const token = await auth?.currentUser?.getIdToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/zkteco/attendance?${new URLSearchParams({ startDate, endDate })}`, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `เรียกข้อมูล Biotime ไม่สำเร็จ (${response.status})`);
  if (body.scheduleSource !== 'biotime' || !body.schedules) throw new Error('API ยังไม่ส่งตารางกะ Biotime กรุณาอัปเดตเซิร์ฟเวอร์ก่อน');
  return body;
}

export { groupDailyPunches } from './biotimeScans';
import { groupDailyPunches } from './biotimeScans';

const biotimeCollection = (periodId) => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, PAYROLL_PERIODS_COLLECTION, periodId, 'biotime');
const docId = (employeeId) => String(employeeId).trim().replace(/[^a-zA-Z0-9_-]/g, '-');

// One document per employee under the period: payrollPeriods/{periodId}/biotime/{employeeId}.
// Picked employees without any scan are still saved (empty `days`). Scans before the period start
// (the lead-in days fetched for the first Sunday's 6-day check) go to `leadInDays`, not `days`.
export async function saveBiotimeAttendance({ period, employees, punches, schedules, leadInStartDate = null }) {
  if (!isFirebaseConfigured) throw new Error('ยังไม่ได้ตั้งค่า Firebase จึงบันทึกข้อมูลไม่ได้');
  await ensureFirebaseReady();
  const grouped = groupDailyPunches(punches, employees.map((employee) => employee.employeeId));
  const fetchedAt = new Date().toISOString();
  for (let index = 0; index < employees.length; index += 400) {
    const batch = writeBatch(db);
    employees.slice(index, index + 400).forEach((employee) => {
      const all = grouped.get(employee.employeeId) || [];
      const data = {
        scheduleSource: 'biotime',
        scheduledDays: schedules[String(employee.employeeId).trim().toLowerCase()] || {},
        employeeId: employee.employeeId,
        name: employee.name || '',
        firstName: employee.firstName || '',
        lastName: employee.lastName || '',
        department: employee.department || '',
        position: employee.position || '',
        startDate: period.startDate,
        endDate: period.endDate,
        days: all.filter((day) => day.date >= period.startDate && day.date <= period.endDate),
        trailingDays: all.filter((day) => day.date > period.endDate),
        leadInStartDate,
        leadInDays: leadInStartDate ? all.filter((day) => day.date < period.startDate) : [],
        fetchedAt,
      };
      // Replace source fields completely while preserving manual overrides.
      batch.set(doc(biotimeCollection(period.id), docId(employee.employeeId)), data, { mergeFields: Object.keys(data) });
    });
    await batch.commit();
  }
  return { employees: employees.length, days: [...grouped.values()].reduce((sum, list) => sum + list.filter((day) => day.date >= period.startDate && day.date <= period.endDate).length, 0) };
}

// Manual time for one day: overrides.{date}.{timeIn|timeOut} = { time: 'HH:MM', reason }.
// `value` null removes it so the Biotime scan is used again.
export async function saveBiotimeOverride({ periodId, employeeId, date, field, value }) {
  if (!isFirebaseConfigured) throw new Error('ยังไม่ได้ตั้งค่า Firebase จึงบันทึกข้อมูลไม่ได้');
  await ensureFirebaseReady();
  const data = value ? { ...value, updatedAt: new Date().toISOString(), updatedBy: auth?.currentUser?.email || '' } : deleteField();
  await updateDoc(doc(biotimeCollection(periodId), docId(employeeId)), new FieldPath('overrides', date, field), data);
}

export function subscribeToBiotimeAttendance({ periodId, onData, onError }) {
  if (!isFirebaseConfigured || !periodId) { onData([]); return () => {}; }
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(biotimeCollection(periodId), (snapshot) => onData(snapshot.docs.map((item) => item.data())), onError);
  }).catch(onError);
  return () => { cancelled = true; unsubscribe(); };
}

// Commit approval and requested times together; retries read the latest request.
export async function approveWageTimeRequest({ period, entryId, employee = {} }) {
  if (!isFirebaseConfigured) throw new Error('ยังไม่ได้ตั้งค่า Firebase จึงบันทึกเวลาไม่ได้');
  await ensureFirebaseReady();
  const periodRef = doc(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, PAYROLL_PERIODS_COLLECTION, period.id);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(periodRef);
    const entries = snapshot.data()?.wageEntries || [];
    const entry = entries.find((item) => item.id === entryId);
    if (!entry?.timeRequest || entry.status !== 'pending') throw new Error('รายการนี้ไม่ได้อยู่ระหว่างรออนุมัติ กรุณาตรวจสอบข้อมูลล่าสุด');
    const error = wageTimeError(entry);
    if (error) throw new Error(error);
    const savedPeriod = snapshot.data();
    if (!entry.date || entry.date < savedPeriod.startDate || entry.date > savedPeriod.endDate) throw new Error('วันที่ขอเพิ่มเวลาอยู่นอกงวด');
    const attendanceRef = doc(biotimeCollection(period.id), docId(entry.employeeId));
    const attendance = await transaction.get(attendanceRef);
    const stamp = { reason: entry.timeReason.trim(), requestId: entry.id, updatedAt: new Date().toISOString(), updatedBy: auth?.currentUser?.email || '' };
    const times = {};
    if (entry.timeInEnabled) times.timeIn = { ...stamp, time: entry.timeIn };
    if (entry.timeOutEnabled) times.timeOut = { ...stamp, time: entry.timeOut };
    const data = { overrides: { [entry.date]: times } };
    if (!attendance.exists()) Object.assign(data, { employeeId: entry.employeeId, name: [employee.firstName, employee.lastName].filter(Boolean).join(' '), firstName: employee.firstName || '', lastName: employee.lastName || '', department: employee.department || '', position: employee.position || '', startDate: savedPeriod.startDate, endDate: savedPeriod.endDate, days: [] });
    const nextEntries = entries.map((item) => item.id === entryId ? { ...item, status: 'approved', approvedAt: stamp.updatedAt, approvedBy: stamp.updatedBy } : item);
    transaction.set(attendanceRef, data, { merge: true });
    transaction.update(periodRef, { wageEntries: nextEntries });
    return nextEntries;
  });
}

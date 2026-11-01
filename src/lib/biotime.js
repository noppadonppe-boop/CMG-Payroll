import { collection, deleteField, doc, FieldPath, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
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
  return body.punches || [];
}

// First and last scan (with the device that took it) of each selected employee per calendar day.
// Returns Map(employeeId -> [{ date, checkIn, checkOut, deviceIn, deviceOut, scans }]).
export function groupDailyPunches(punches, employeeIds) {
  const idByKey = new Map(employeeIds.map((id) => [String(id).trim().toLowerCase(), id]));
  const days = new Map();
  for (const { empCode, punchTime, device = '' } of punches) {
    const employeeId = idByKey.get(empCode.toLowerCase());
    if (!employeeId) continue;
    const key = `${employeeId}|${punchTime.slice(0, 10)}`;
    const entry = days.get(key);
    if (!entry) days.set(key, { employeeId, date: punchTime.slice(0, 10), first: punchTime, last: punchTime, deviceIn: device, deviceOut: device, scans: 1 });
    else {
      entry.scans += 1;
      if (punchTime < entry.first) { entry.first = punchTime; entry.deviceIn = device; }
      if (punchTime > entry.last) { entry.last = punchTime; entry.deviceOut = device; }
    }
  }
  const result = new Map(employeeIds.map((id) => [id, []]));
  for (const entry of days.values()) {
    const single = entry.scans < 2;
    result.get(entry.employeeId).push({
      date: entry.date,
      checkIn: entry.first.slice(11, 19),
      checkOut: single ? '' : entry.last.slice(11, 19),
      deviceIn: entry.deviceIn,
      deviceOut: single ? '' : entry.deviceOut,
      scans: entry.scans,
    });
  }
  result.forEach((list) => list.sort((a, b) => a.date.localeCompare(b.date)));
  return result;
}

const biotimeCollection = (periodId) => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, PAYROLL_PERIODS_COLLECTION, periodId, 'biotime');
const docId = (employeeId) => String(employeeId).trim().replace(/[^a-zA-Z0-9_-]/g, '-');

// One document per employee under the period: payrollPeriods/{periodId}/biotime/{employeeId}.
// Picked employees without any scan are still saved (empty `days`). Scans before the period start
// (the lead-in days fetched for the first Sunday's 6-day check) go to `leadInDays`, not `days`.
export async function saveBiotimeAttendance({ period, employees, punches, leadInStartDate = null }) {
  if (!isFirebaseConfigured) throw new Error('ยังไม่ได้ตั้งค่า Firebase จึงบันทึกข้อมูลไม่ได้');
  await ensureFirebaseReady();
  const grouped = groupDailyPunches(punches, employees.map((employee) => employee.employeeId));
  const fetchedAt = new Date().toISOString();
  for (let index = 0; index < employees.length; index += 400) {
    const batch = writeBatch(db);
    employees.slice(index, index + 400).forEach((employee) => {
      const all = grouped.get(employee.employeeId) || [];
      batch.set(doc(biotimeCollection(period.id), docId(employee.employeeId)), {
        employeeId: employee.employeeId,
        name: employee.name || '',
        firstName: employee.firstName || '',
        lastName: employee.lastName || '',
        department: employee.department || '',
        position: employee.position || '',
        startDate: period.startDate,
        endDate: period.endDate,
        days: all.filter((day) => day.date >= period.startDate),
        leadInStartDate,
        leadInDays: leadInStartDate ? all.filter((day) => day.date < period.startDate) : [],
        fetchedAt,
      }, { merge: true }); // merge keeps the manual time `overrides` across re-fetches
    });
    await batch.commit();
  }
  return { employees: employees.length, days: [...grouped.values()].reduce((sum, list) => sum + list.filter((day) => day.date >= period.startDate).length, 0) };
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

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';
import { db, ensureFirebaseReady, ensureMasterDatabaseReady, isFirebaseConfigured, isMasterDatabaseConfigured, masterDb } from './firebase';
import { FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT } from './repository';

// Company holidays. The master list is read-only here: CMG-HR-Database/root/day_offs/{YYYY-MM-DD}
// ({ date, name, createdAt }). "Sync วันหยุด" copies it into this system at
// CMG-Payroll/root/holidays/{YYYY-MM-DD}, which the Biotime report reads (วันหยุดบริษัท column).
export const MASTER_DATABASE_HOLIDAY_PATH = 'CMG-HR-Database/root/day_offs';
const holidaysCollection = () => collection(db, FIREBASE_ROOT_COLLECTION, FIREBASE_ROOT_DOCUMENT, 'holidays');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIsoDate = (value) => {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  const text = String(value).trim();
  return ISO_DATE.test(text) ? text : '';
};

const parseMasterHolidays = (documents) => {
  const byDate = new Map();
  documents.forEach((item) => {
    const data = item.data() || {};
    const date = toIsoDate(data.date) || toIsoDate(item.id);
    if (!date) return;
    byDate.set(date, { date, name: String(data.name ?? '').trim() });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

// Copies the master holidays into this system. Dates removed from the master are removed here
// too, so the local copy always mirrors the master list. Returns the counts for the toast.
export async function syncHolidays() {
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
  await ensureFirebaseReady();
  const master = parseMasterHolidays((await getDocs(collection(masterDb, MASTER_DATABASE_HOLIDAY_PATH))).docs);
  const stored = new Map((await getDocs(holidaysCollection())).docs.map((item) => [item.id, item.data()]));
  const syncedAt = new Date().toISOString();
  const masterDates = new Set(master.map((holiday) => holiday.date));
  const result = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const writes = [];
  master.forEach((holiday) => {
    const existing = stored.get(holiday.date);
    if (!existing) result.created += 1;
    else if (existing.name !== holiday.name) result.updated += 1;
    else { result.unchanged += 1; return; }
    writes.push((batch) => batch.set(doc(holidaysCollection(), holiday.date), { ...holiday, source: MASTER_DATABASE_HOLIDAY_PATH, syncedAt }));
  });
  stored.forEach((_, date) => {
    if (masterDates.has(date)) return;
    result.removed += 1;
    writes.push((batch) => batch.delete(doc(holidaysCollection(), date)));
  });
  for (let index = 0; index < writes.length; index += 400) {
    const batch = writeBatch(db);
    writes.slice(index, index + 400).forEach((write) => write(batch));
    await batch.commit();
  }
  return { ...result, total: master.length, syncedAt };
}

export function subscribeToHolidays({ onData, onError }) {
  if (!isFirebaseConfigured) { onData([]); return () => {}; }
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseReady().then(() => {
    if (cancelled) return;
    unsubscribe = onSnapshot(
      holidaysCollection(),
      (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.date).localeCompare(String(b.date)))),
      onError,
    );
  }).catch(onError);
  return () => { cancelled = true; unsubscribe(); };
}

// Live holidays plus `holidayFor(date)` → { date, name } | null for the report calculation.
export function useHolidays() {
  const [holidays, setHolidays] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => subscribeToHolidays({
    onData: (data) => { setHolidays(data); setLoaded(true); },
    onError: (error) => { console.warn('อ่านวันหยุดบริษัทไม่สำเร็จ', error); setLoaded(true); },
  }), []);
  const holidayFor = useMemo(() => {
    const byDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
    return (date) => byDate.get(date) || null;
  }, [holidays]);
  return { holidays, loaded, holidayFor };
}

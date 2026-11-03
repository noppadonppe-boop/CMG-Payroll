import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchZkAttendance, validateRange } from './zkteco.js';

initializeApp();

const ALLOWED_ROLES = ['MasterAdmin', 'PayrollAdmin'];

const authorize = async (request) => {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const decoded = await getAuth().verifyIdToken(token);
  const snapshot = await getFirestore().doc(`CMG-Payroll/root/users/${String(decoded.email || '').trim().toLowerCase()}`).get();
  const user = snapshot.data();
  return Boolean(user && user.status === 'approved' && (user.role || []).some((role) => ALLOWED_ROLES.includes(role)));
};

// Read-only: asks ZKBioTime for a JWT, then lists scan transactions for the range.
export const zktecoApi = onRequest({ region: 'asia-southeast1', cors: true }, async (request, response) => {
  try {
    if (!(await authorize(request))) { response.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งาน' }); return; }
    const { startDate, endDate } = request.method === 'GET' ? request.query : request.body || {};
    if (!validateRange(startDate, endDate)) { response.status(400).json({ error: 'ช่วงวันที่ไม่ถูกต้อง' }); return; }
    response.json(await fetchZkAttendance({ startDate, endDate }));
  } catch (error) {
    console.error('zkteco', error);
    response.status(502).json({ error: error.message || 'เรียก ZKBioTime ไม่สำเร็จ' });
  }
});

// Read-only ZKBioTime client. Shared by the Cloud Function and the Vite dev server,
// so credentials (ZK_API_*) only ever live on the server side.
const trimSlash = (value) => String(value || '').replace(/\/+$/, '');

export const readZkConfig = (env = process.env) => ({
  baseUrl: trimSlash(env.ZK_API_BASE_URL),
  username: env.ZK_API_USERNAME,
  password: env.ZK_API_PASSWORD,
});

const requestJson = async (url, options) => {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const reason = error.cause?.code || error.cause?.message || error.name;
    throw new Error(`เชื่อมต่อ ${new URL(url).origin} ไม่ได้ (${reason}) · ตรวจสอบ URL/พอร์ตใน ZK_API_BASE_URL และว่าเครื่องนี้เข้าถึงเซิร์ฟเวอร์ได้`);
  }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!response.ok) throw new Error(`ZKBioTime ${response.status}: ${(body && (body.detail || body.non_field_errors?.[0])) || text.slice(0, 120)}`);
  return body;
};

// ZKBioTime 8 issues a real JWT at /jwt-api-token-auth/ (header `JWT <token>`); older builds only
// have /api-token-auth/, whose DRF token is sent as `Token <token>`. Using the wrong prefix gives
// "401 Error decoding signature", so remember which endpoint the token came from.
export const requestZkToken = async ({ baseUrl, username, password }) => {
  if (!baseUrl || !username || !password) throw new Error('ยังไม่ได้ตั้งค่า ZK_API_BASE_URL / ZK_API_USERNAME / ZK_API_PASSWORD');
  const login = (path) => requestJson(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  try {
    const body = await login('/jwt-api-token-auth/');
    if (body?.token) return { scheme: 'JWT', token: body.token };
  } catch (error) {
    if (!/ZKBioTime 404/.test(error.message)) throw error;
  }
  const body = await login('/api-token-auth/');
  if (!body?.token) throw new Error('ZKBioTime ไม่ส่ง token กลับมา');
  return { scheme: 'Token', token: body.token };
};

// startDate / endDate are YYYY-MM-DD. Returns [{ empCode, punchTime, device }] sorted by time.
export const fetchZkTransactions = async ({ config = readZkConfig(), startDate, endDate }) => {
  const { scheme, token } = await requestZkToken(config);
  const headers = { Authorization: `${scheme} ${token}` };
  const punches = [];
  let url = `${config.baseUrl}/iclock/api/transactions/?${new URLSearchParams({
    start_time: `${startDate} 00:00:00`,
    end_time: `${endDate} 23:59:59`,
    page_size: '1000',
  })}`;
  for (let page = 0; url && page < 200; page += 1) {
    const body = await requestJson(url, { headers });
    for (const item of body?.data || []) {
      if (item.emp_code && item.punch_time) punches.push({ empCode: String(item.emp_code).trim(), punchTime: String(item.punch_time), device: String(item.terminal_alias || item.terminal_sn || '').trim() });
    }
    url = body?.next ? (body.next.startsWith('http') ? body.next : `${config.baseUrl}${body.next}`) : null;
  }
  return punches.sort((a, b) => a.punchTime.localeCompare(b.punchTime));
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const validateRange = (startDate, endDate) => DATE_PATTERN.test(startDate || '') && DATE_PATTERN.test(endDate || '') && startDate <= endDate;

// Read timetable definitions, not shift-detail out_time (which can be a scan window).
async function fetchZkRows(config, headers, path) {
  let url = new URL(path, `${config.baseUrl}/`);
  const rows = [];
  for (let page = 0; url && page < 200; page += 1) {
    if (url.origin !== new URL(config.baseUrl).origin) throw new Error('Biotime pagination origin mismatch');
    const body = await requestJson(url.toString(), { headers });
    if (!Array.isArray(body?.data)) throw new Error('Biotime ส่งรูปแบบตารางกะไม่ถูกต้อง');
    rows.push(...body.data);
    if (!body.next || rows.length >= body.count) return rows;
    url = new URL(body.next, url);
  }
  throw new Error('ข้อมูล Biotime เกินจำนวนหน้าที่รองรับ');
}

export function resolveZkSchedules({ employees, assignments, shifts, details, intervals, startDate, endDate }) {
  const result = {};
  for (const employee of employees) {
    const days = {};
    for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const matches = assignments.filter(a => a.employee === employee.id && a.start_date <= date && a.end_date >= date);
      if (matches.length > 1) throw new Error(`Biotime มีกะซ้อนกัน: ${employee.emp_code} ${date}`);
      const assignment = matches[0];
      if (!assignment) continue;
      const shift = shifts.find(s => s.id === assignment.shift);
      if (!shift) throw new Error(`ไม่พบกะ Biotime ${assignment.shift}`);
      let index;
      if (shift.cycle_unit === 1 && shift.shift_cycle === 1) index = cursor.getUTCDay() || 7;
      else if (shift.cycle_unit === 0 && shift.shift_cycle === 1) index = 0;
      else throw new Error(`ยังไม่รองรับรอบกะ Biotime: ${shift.alias}`);
      const slots = details.filter(d => d.shift === shift.id && d.day_index === index);
      if (!slots.length) continue;
      if (slots.length !== 1) throw new Error(`Biotime มีหลายช่วงเวลาต่อวัน: ${shift.alias}`);
      const interval = intervals.find(t => t.id === slots[0].time_interval);
      if (!interval?.in_time || !interval?.out_time) throw new Error(`ไม่พบตารางเวลาของกะ ${shift.alias}`);
      days[date] = { name: shift.alias, startTime: interval.in_time.slice(0, 5), endTime: interval.out_time.slice(0, 5), source: 'biotime', shiftId: shift.id, timetableId: interval.id };
    }
    result[String(employee.emp_code).trim().toLowerCase()] = days;
  }
  return result;
}

export async function fetchZkAttendance({ config = readZkConfig(), startDate, endDate }) {
  const { scheme, token } = await requestZkToken(config);
  const headers = { Authorization: `${scheme} ${token}` };
  const paths = ['/personnel/api/employees/', '/att/api/attschedules/', '/att/api/attshifts/', '/att/api/shift_details/', '/att/api/timeintervals/', '/att/api/tempschedules/'];
  const [employees, assignments, shifts, details, intervals, temporary] = await Promise.all(paths.map(path => fetchZkRows(config, headers, `${path}?page_size=1000`)));
  // Fail rather than silently substituting a regular shift for a temporary assignment.
  if (temporary.length) throw new Error('พบกะชั่วคราวใน Biotime ซึ่งยังไม่รองรับ กรุณาตรวจสอบก่อนดึงข้อมูล');
  const schedules = resolveZkSchedules({ employees, assignments: assignments.filter(a => a.start_date <= endDate && a.end_date >= startDate), shifts, details, intervals, startDate, endDate });
  return { punches: await fetchZkTransactions({ config, startDate, endDate }), schedules, scheduleSource: 'biotime' };
}

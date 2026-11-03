import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { groupDailyPunches, workDaysFromScans } from '../src/lib/biotimeScans.js';
const employee = 'DC3075';
const night = { startTime: '18:00', endTime: '06:00' };
const shiftFor = (_, date) => date >= '2026-10-21' ? night : null;
const punches = [
  ['2026-10-21 17:52:01', 'in'], ['2026-10-21 17:52:20', 'duplicate'],
  ['2026-10-22 06:00:00', 'out'], ['2026-10-22 17:40:00', 'next-in'],
  ['2026-10-23 06:00:00', 'next-out'],
].map(([punchTime, device]) => ({ empCode: employee, punchTime, device }));
const days = groupDailyPunches(punches.reverse(), [employee]).get(employee);
assert.equal(days[0].scans, 1);
assert.equal(days[0].checkOut, '');
assert.equal(days[0].punches.length, 2);
const work = workDaysFromScans(days, employee, shiftFor);
assert.equal(work[0].date, '2026-10-21');
assert.equal(work[0].checkIn, '17:52:01');
assert.equal(work[0].checkOut, '06:00:00');
assert.equal(work[0].deviceOut, 'out');
assert.equal(work[1].checkIn, '17:40:00');
assert.equal(work.length, 2);
const legacy = days.map(({ punches, ...day }) => day);
assert.equal(workDaysFromScans(legacy, employee, shiftFor)[0].checkOut, '06:00:00');
for (const [time, count] of [['09:29:59', 1], ['09:30:00', 2]]) {
  const result = groupDailyPunches(['07:30:00', time].map(t => ({ empCode: employee, punchTime: `2026-10-20 ${t}` })), [employee]);
  assert.equal(result.get(employee)[0].scans, count);
}
const orphan = workDaysFromScans([{ date: '2026-10-22', checkIn: '06:00', checkOut: '' }], employee, shiftFor);
assert.equal(orphan[0].checkIn, '');
assert.equal(orphan[0].checkOut, '06:00:00');
const server = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildEmployeeReport } = await server.ssrLoadModule('/src/lib/biotimeReport.js');
  const record = { employeeId: employee, startDate: '2026-10-21', endDate: '2026-10-22', days: days.slice(0, 2), trailingDays: days.slice(2) };
  const report = buildEmployeeReport(record, shiftFor);
  assert.equal(report.rows[0].timeIn, '17:52');
  assert.equal(report.rows[0].timeOut, '06:00');
  assert.equal(report.rows[1].timeIn, '17:40');
  assert.equal(report.rows[1].timeOut, '06:00');
  assert.equal(report.totals.normal, 2);
  assert.equal(report.totals.ot, 0);
  record.overrides = { '2026-10-21': { timeOut: { time: '05:00', reason: 'manual' } } };
  assert.equal(buildEmployeeReport(record, shiftFor).rows[0].timeOut, '05:00');
  const missing = buildEmployeeReport({ ...record, overrides: {}, days: [days[0]], trailingDays: [] }, shiftFor);
  assert.equal(missing.rows[0].timeOut, '');
  assert.equal(missing.rows[0].normal, 0);
  console.log('Biotime duplicate and overnight checks passed');
} finally { await server.close(); }

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildEmployeeReport } = await server.ssrLoadModule('/src/lib/biotimeReport.js');
  const { buildShiftSchedule } = await server.ssrLoadModule('/src/lib/shiftSchedule.js');
  const { validateLateGraceMinutes } = await server.ssrLoadModule('/src/lib/attendancePolicy.js');
  const date = '2026-11-02';
  const shifts = { a: [{ id: 'day', startTime: '07:00', endTime: '16:00' }], b: [{ id: 'day', startTime: '08:00', endTime: '17:00' }] };
  const assignments = { a: [{ employeeId: '1', shiftId: 'day', startDate: date, endDate: date }], b: [{ employeeId: '2', shiftId: 'day', startDate: date, endDate: date }] };
  const schedule = buildShiftSchedule(shifts, assignments, [{ id: 'a', lateGraceMinutes: 10 }, { id: 'b', lateGraceMinutes: 5 }]);
  const report = (checkIn, checkOut = '16:00', shiftFor = schedule, overrides) => buildEmployeeReport({ employeeId: '1', startDate: date, endDate: date, days: [{ date, checkIn, checkOut }], overrides }, shiftFor);
  assert.equal(schedule('1', date).lateGraceMinutes, 10);
  assert.equal(schedule('2', date).lateGraceMinutes, 5);
  assert.equal(schedule('2', date).startTime, '08:00');
  assert.equal(schedule('1', '2026-11-03'), null);
  for (const time of ['06:50', '07:00', '07:09', '07:10']) assert.equal(report(time).totals.normal, 1, time);
  assert.equal(report('07:11').totals.normal, 0.9);
  assert.equal(report('07:09').rows[0].timeIn, '07:09');
  assert.equal(report('07:09', '15:00').totals.normal, 0.8);
  assert.equal(report('07:09', '').totals.normal, 0);
  assert.equal(report('07:09', '07:09').totals.normal, 0);
  assert.equal(report('07:09', '07:08').totals.normal, 0);
  assert.equal(report('07:09', '17:00').totals.ot, 1);
  const legacy = buildShiftSchedule(shifts, assignments);
  assert.equal(report('07:09', '16:00', legacy).totals.normal, 0.9);
  const changed = buildShiftSchedule(shifts, assignments, [{ id: 'a', lateGraceMinutes: 5 }]);
  assert.equal(report('07:09', '16:00', changed).totals.normal, 0.9);
  assert.equal(report('08:00', '16:00', schedule, { [date]: { timeIn: { time: '07:09', reason: 'corrected' } } }).totals.normal, 1);
  for (const value of [-1, 1.5, 'bad', Infinity]) assert.throws(() => validateLateGraceMinutes(value));
  assert.equal(validateLateGraceMinutes('10'), 10);
  console.log('Attendance grace checks passed');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import { resolveZkSchedules } from '../functions/zkteco.js';
import { createServer } from 'vite';
const input = {
 employees: [{ id: 10, emp_code: 'DC3075' }],
 assignments: [{ employee: 10, shift: 44, start_date: '2026-10-21', end_date: '2026-11-03' }],
 shifts: [{ id: 44, alias: 'J-74 Night Shift', cycle_unit: 0, shift_cycle: 1 }],
 details: [{ shift: 44, day_index: 0, time_interval: 42, in_time: '18:00:00', out_time: '18:00:00' }],
 intervals: [{ id: 42, in_time: '18:00:00', out_time: '03:00:00' }],
 startDate: '2026-10-20', endDate: '2026-10-24',
};
const schedules = resolveZkSchedules(input);
assert.equal(schedules.dc3075['2026-10-20'], undefined);
assert.equal(schedules.dc3075['2026-10-21'].endTime, '03:00');
assert.equal(schedules.dc3075['2026-10-24'].startTime, '18:00');
assert.throws(() => resolveZkSchedules({ ...input, intervals: [] }));
assert.throws(() => resolveZkSchedules({ ...input, assignments: [...input.assignments, ...input.assignments] }));
const weekly = resolveZkSchedules({ ...input, shifts: [{ ...input.shifts[0], cycle_unit: 1 }], details: [{ ...input.details[0], day_index: 3 }] });
assert.equal(weekly.dc3075['2026-10-21'].endTime, '03:00');
assert.equal(weekly.dc3075['2026-10-22'], undefined);
const server = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
 const { buildEmployeeReport } = await server.ssrLoadModule('/src/lib/biotimeReport.js');
 const record = { employeeId: 'DC3075', startDate: '2026-10-21', endDate: '2026-10-21', scheduleSource: 'biotime', scheduledDays: schedules.dc3075, days: [{date:'2026-10-21',checkIn:'17:52:00',checkOut:''}],trailingDays:[{date:'2026-10-22',checkIn:'06:00:00',checkOut:''}] };
 const local = () => ({startTime:'18:00',endTime:'06:00'});
 const row = buildEmployeeReport(record,local).rows[0];
 assert.equal(row.shiftStart,'18:00'); assert.equal(row.shiftEnd,'03:00');
 assert.equal(row.timeOut,'06:00'); assert.equal(row.normal,1);
 const missing=buildEmployeeReport({...record,scheduledDays:{}},local).rows[0];
 assert.equal(missing.shiftEnd,''); assert.equal(missing.normal,0);
 assert.equal(buildEmployeeReport({...record,overrides:{'2026-10-21':{timeOut:{time:'05:00'}}}},local).rows[0].timeOut,'05:00');
 assert.equal(row.ot,3);
 const overtime = (time, extra = {}, holidayFor) => buildEmployeeReport({ ...record, ...extra, overrides: { '2026-10-21': { timeOut: { time } } } }, local, holidayFor);
 for (const [time, expected] of [['00:00',0],['02:59',0],['03:00',0],['03:29',0],['03:30',0.5],['05:00',2],['06:00',3],['06:03',3],['06:30',3.5],['23:00',0]]) {
   assert.equal(overtime(time).rows[0].ot, expected, time);
   assert.equal(overtime(time).totals.ot, expected, time);
 }
 assert.equal(buildEmployeeReport({...record,trailingDays:[]},local).totals.ot,0);
 assert.equal(buildEmployeeReport({...record,days:[]},local).totals.ot,0);
 assert.equal(overtime('06:00',{},()=>({name:'Holiday'})).totals.ot,0);
 assert.equal(missing.ot,0);
 console.log('Biotime schedule and overnight OT checks passed');
} finally {await server.close();}

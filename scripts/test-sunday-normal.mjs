import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
 const {buildEmployeeReport} = await server.ssrLoadModule('/src/lib/biotimeReport.js');
 const date='2026-10-18';
 const record={employeeId:'DC3075',startDate:'2026-10-12',endDate:date,scheduleSource:'biotime',scheduledDays:{},days:[{date,checkIn:'06:40',checkOut:'16:10'}]};
 const report=(changes={},holidayFor)=>buildEmployeeReport({...record,...changes},()=>null,holidayFor);
 const row=report().rows.at(-1);
 assert.equal(row.sundayAsNormal,true); assert.equal(row.normal,1); assert.equal(row.sunday,0);assert.equal(row.ot,0);assert.equal(report().totals.normal,1);
 for(const [out,expected] of [['15:40',1],['11:10',0.5],['16:10',1],['',0]]) assert.equal(report({days:[{date,checkIn:'06:40',checkOut:out}]}).rows.at(-1).normal,expected);
 assert.equal(report({overrides:{[date]:{timeOut:{time:'11:10'}}}}).rows.at(-1).normal,0.5);
 const assigned={startTime:'07:00',endTime:'16:00'};
 assert.equal(report({scheduledDays:{[date]:assigned}}).rows.at(-1).normal,1);
 const night={startTime:'18:00',endTime:'03:00'};
 const overnight=report({scheduledDays:{[date]:night},days:[{date,checkIn:'17:40',checkOut:''}],trailingDays:[{date:'2026-10-19',checkIn:'02:40',checkOut:''}]}).rows.at(-1);
 assert.equal(overnight.normal,1); assert.equal(overnight.ot,0);
 const prior=['12','13','14','15','16','17'].map(d=>({date:`2026-10-${d}`,checkIn:'07:00',checkOut:'16:00'}));
 const sunday=report({days:[...prior,...record.days],scheduledDays:{[date]:assigned}}).rows.at(-1);
 assert.equal(sunday.sundayAsNormal,false); assert.equal(sunday.normal,0);assert.equal(sunday.sunday,9);
 const holiday=report({scheduledDays:{[date]:assigned}},()=>({name:'Holiday'})).rows.at(-1);
 assert.equal(holiday.normal,0);assert.equal(holiday.holiday,9);
 console.log('Sunday actual-hours checks passed');
} finally {await server.close();}

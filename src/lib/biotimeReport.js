import { workDaysFromScans } from './biotimeScans';
// Builds the per-employee attendance report (same layout as the HR Excel sample) from the
// first/last scan per day saved under the period.
//
// Rules derived from the sample report:
//  - Mon–Sat shift is 07:30–16:30; Sunday is a rest day (00:00–23:59).
//  - วันปกติ = actual hours within the shift / 9, capped at 1 and floored to one decimal.
//    Both check-in and check-out are required; time outside the shift is excluded.
//  - OT1.5, วันอาทิตย์ and วันหยุดบริษัท are in hours. OT1.5 counts completed 30-minute blocks
//    after the shift end (16:30), e.g. out 17:00 → 0.5, 17:31 → 1, 19:43 → 3.
//  - วันอาทิตย์ = 9 hours (shift length) for a Sunday with a scan, but only after 6 consecutive
//    worked days (Mon–Sat all scanned). Otherwise the Sunday is paid as a normal day (prorated,
//    actual elapsed hours / 9, capped at 1 day) and flagged `sundayAsNormal`. Days before the period start
//    are covered by `leadInDays` (fetched with the period, or taken from the previous period);
//    without them, if those are the only gap the Sunday rate stays, flagged `sundayUnverified`.
//  - วันหยุดบริษัท: a non-Sunday-rate day listed by `holidayFor(date)` (menu วันหยุดบริษัท) with a scan
//    pays the shift length (9 h by default) in this column instead of วันปกติ, and gets no OT.
//  - A day with a shift from ตั้งกะการทำงาน (`shiftFor`) uses that shift's start/end instead of the
//    defaults above, whatever Biotime sends: OT counts from its end and a Sunday pays its length.
//    Overnight shifts pair the next morning checkout with the shift start date, including OT.
//  - A time ticked and typed in by hand (`record.overrides`) is used instead of the Biotime scan,
//    e.g. scan out 19:00 (OT 2.5) overridden to 17:00 → OT 0.5.
import { shiftHours } from './shifts';
import { lateGraceMinutes } from './attendancePolicy';

export const SHIFT_START = '07:30';
export const SHIFT_END = '16:30';
export const REST_DAY_START = '00:00';
export const REST_DAY_END = '23:59';
export const WORK_DAY_HOURS = 9;
const THAI_WEEKDAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

const toMinutes = (time) => {
  const [hours, minutes] = String(time || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

// YYYY-MM-DD list from start to end inclusive (UTC maths, so no daylight-saving drift).
const datesBetween = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const addDays = (date, days) => {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
};

export const formatReportDate = (date) => date.split('-').reverse().join('/');

// 24-hour time typed as "17:00" or "17.00" (also "7:05") → "HH:MM"; anything else → null.
export function parseTime(value) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? `${String(hours).padStart(2, '0')}:${match[2]}` : null;
}

// Manual times ticked in the report (`overrides[date].timeIn/timeOut = { time, reason }`) replace
// the Biotime scan for every calculation; the scan itself stays in `days` untouched.
const applyOverrides = (days, overrides = {}) => {
  const byDate = new Map(days.map((day) => [day.date, day]));
  Object.entries(overrides || {}).forEach(([date, override]) => {
    const timeIn = parseTime(override?.timeIn?.time);
    const timeOut = parseTime(override?.timeOut?.time);
    if (!timeIn && !timeOut) return;
    const day = byDate.get(date) || { date, checkIn: '', checkOut: '', deviceIn: '', deviceOut: '', scans: 0 };
    byDate.set(date, { ...day, checkIn: timeIn || day.checkIn, checkOut: timeOut || day.checkOut });
  });
  return [...byDate.values()];
};

// First day the 6-day check of the period's first Sunday needs, when that falls before the period
// start (e.g. Sunday is the 4th day → 3 days back). null when the period already covers it.
export function leadInStartDate(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const firstSunday = datesBetween(startDate, endDate).slice(0, 7).find((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0);
  const leadStart = firstSunday ? addDays(firstSunday, -6) : null;
  return leadStart && leadStart < startDate ? leadStart : null;
}

// Fills `leadInDays` for records saved before lead-in days were fetched, from the previous
// period's saved scans of the same employee (when that period ends the day before this one starts).
export function attachLeadIn(record, previousRecord) {
  if (!record || record.leadInStartDate) return record;
  const leadStart = leadInStartDate(record.startDate, record.endDate);
  if (!leadStart || !previousRecord || previousRecord.endDate < addDays(record.startDate, -1)) return record;
  const leadInDays = applyOverrides(previousRecord.days || [], previousRecord.overrides).filter((day) => day.date >= leadStart && day.date < record.startDate);
  return { ...record, leadInStartDate: leadStart, leadInDays, leadInSource: 'previous' };
}

export const previousPeriodOf = (periods, startDate) => (startDate ? periods.find((item) => item.endDate === addDays(startDate, -1)) : undefined);

export function buildEmployeeReport(record, shiftFor = () => null, holidayFor = () => null) {
  const biotimeSchedule = record?.scheduleSource === 'biotime';
  if (biotimeSchedule) {
    const localShiftFor = shiftFor;
    shiftFor = (id, date) => record.scheduledDays?.[date] ? { ...record.scheduledDays[date], lateGraceMinutes: localShiftFor(id, date)?.lateGraceMinutes } : null;
  }
  const leadInDays = record?.leadInStartDate ? record.leadInDays || [] : [];
  const workDays = workDaysFromScans([...leadInDays, ...(record?.days || []), ...(record?.trailingDays || [])], record?.employeeId, shiftFor);
  const rawByDate = new Map(workDays.map((day) => [day.date, day]));
  const overrides = record?.overrides || {};
  const byDate = new Map(applyOverrides(workDays, overrides).map((day) => [day.date, day]));
  const knownFrom = record?.leadInStartDate || record?.startDate;
  const dates = record?.startDate && record?.endDate ? datesBetween(record.startDate, record.endDate) : (record?.days || []).map((day) => day.date).sort();
  const totals = { normal: 0, ot: 0, sunday: 0, holiday: 0 };
  // Days before the period, shown greyed for checking the first Sunday only; never counted.
  const leadInRows = record?.leadInStartDate && record?.startDate ? datesBetween(record.leadInStartDate, addDays(record.startDate, -1)).map((date) => {
    const day = byDate.get(date);
    const weekdayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
    const assigned = shiftFor(record?.employeeId, date);
    return {
      date, leadIn: true, weekday: THAI_WEEKDAYS[weekdayIndex], isSunday: weekdayIndex === 0, shiftName: assigned?.name || '',
      shiftStart: assigned ? assigned.startTime : biotimeSchedule ? '' : SHIFT_START, shiftEnd: assigned ? assigned.endTime : biotimeSchedule ? '' : SHIFT_END,
      deviceIn: day?.deviceIn || '', deviceOut: day?.deviceOut || '',
      timeIn: day?.checkIn ? day.checkIn.slice(0, 5) : '', timeOut: day?.checkOut ? day.checkOut.slice(0, 5) : '',
      normal: 0, ot: 0, sunday: 0, holiday: 0,
    };
  }) : [];
  const rows = dates.map((date) => {
    const day = byDate.get(date);
    const weekdayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isSunday = weekdayIndex === 0;
    const assigned = shiftFor(record?.employeeId, date);
    // Sunday rate needs the 6 days before it (Mon–Sat) all worked.
    let sundayAsNormal = false;
    let sundayUnverified = false;
    if (isSunday && day?.checkIn) {
      const prior = [1, 2, 3, 4, 5, 6].map((back) => addDays(date, -back));
      const unknown = prior.filter((d) => !byDate.has(d) && knownFrom && d < knownFrom);
      sundayAsNormal = prior.some((d) => !unknown.includes(d) && !byDate.get(d)?.checkIn);
      sundayUnverified = !sundayAsNormal && unknown.length > 0;
    }
    const restDay = isSunday && !sundayAsNormal;
    // A company holiday (synced from the master database) on a working day pays holiday hours instead.
    const holiday = restDay ? null : holidayFor(date);
    const row = {
      date,
      weekday: THAI_WEEKDAYS[weekdayIndex],
      isSunday,
      sundayAsNormal,
      sundayUnverified,
      holidayName: holiday ? holiday.name || 'วันหยุดบริษัท' : '',
      shiftName: assigned?.name || '',
      lateGraceMinutes: lateGraceMinutes(assigned?.lateGraceMinutes),
      shiftStart: assigned ? assigned.startTime : biotimeSchedule ? '' : restDay ? REST_DAY_START : SHIFT_START,
      shiftEnd: assigned ? assigned.endTime : biotimeSchedule ? '' : restDay ? REST_DAY_END : SHIFT_END,
      deviceIn: day?.deviceIn || '',
      deviceOut: day?.deviceOut || '',
      timeIn: day?.checkIn ? day.checkIn.slice(0, 5) : '',
      timeOut: day?.checkOut ? day.checkOut.slice(0, 5) : '',
      rawTimeIn: rawByDate.get(date)?.checkIn?.slice(0, 5) || '',
      rawTimeOut: rawByDate.get(date)?.checkOut?.slice(0, 5) || '',
      overrideIn: overrides[date]?.timeIn || null,
      overrideOut: overrides[date]?.timeOut || null,
      normal: 0,
      ot: 0,
      sunday: 0,
      holiday: 0,
    };
    const clockIn = toMinutes(row.timeIn);
    const out = toMinutes(row.timeOut);
    const start = toMinutes(row.shiftStart);
    const end = toMinutes(row.shiftEnd);
    const overnight = Boolean(assigned) && end <= start;
    if (sundayAsNormal && !holiday && clockIn !== null && out !== null) {
      // A rest day paid as normal uses actual elapsed work, even without a timetable.
      const clockOut = overnight && out < clockIn ? out + 1440 : out;
      const workedMinutes = Math.max(0, clockOut - clockIn);
      row.normal = Math.min(1, Math.floor(workedMinutes * 10 / (WORK_DAY_HOURS * 60)) / 10);
    } else if (day?.checkIn && (!biotimeSchedule || assigned)) {
      const dayHours = assigned ? shiftHours(assigned.startTime, assigned.endTime) : WORK_DAY_HOURS;
      if (restDay) row.sunday = dayHours;
      else if (holiday) row.holiday = dayHours;
      else if (clockIn !== null && out !== null && start !== null && end !== null) {
        // Overnight checkout belongs to the next calendar day.
        // Credit the scheduled start only inside the project's inclusive grace window.
        // Keep the actual scan visible and require a checkout after the check-in.
        const effectiveIn = clockIn >= start && clockIn <= start + row.lateGraceMinutes ? start : clockIn;
        const clockOut = overnight && out < clockIn ? out + 1440 : out;
        const workedMinutes = clockOut > clockIn ? Math.max(0, Math.min(clockOut, overnight ? end + 1440 : end) - Math.max(effectiveIn, start)) : 0;
        row.normal = Math.min(1, Math.floor(workedMinutes * 10 / (WORK_DAY_HOURS * 60)) / 10);
      }
    }
    if (!restDay && !holiday && out !== null && end !== null) {
      // Compare checkout and scheduled end on the same timeline across midnight.
      // A lone morning checkout cannot establish an overnight work interval.
      if (!overnight || clockIn !== null) {
        const clockOut = overnight && out < clockIn ? out + 1440 : out;
        const shiftEnd = overnight ? end + 1440 : end;
        row.ot = Math.max(0, Math.floor((clockOut - shiftEnd) / 30) * 0.5);
      }
    }
    totals.normal = Math.round((totals.normal + row.normal) * 10) / 10;
    totals.ot += row.ot;
    totals.sunday += row.sunday;
    totals.holiday += row.holiday;
    return row;
  });
  return { rows: [...leadInRows, ...rows], totals };
}

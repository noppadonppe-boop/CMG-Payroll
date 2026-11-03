// Scan timestamps are Biotime local wall-clock times; UTC is used only for date arithmetic.
export const nextDate = (date, offset = 1) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const night = (shift) => shift && minutes(shift.endTime) <= minutes(shift.startTime);
const stamp = (value) => Date.parse(`${value.slice(0, 10)}T${value.slice(11, 19)}Z`);

// Keep calendar-day raw scans so changing the schedule can rebuild the report.
export function groupDailyPunches(punches, employeeIds) {
  const ids = new Map(employeeIds.map((id) => [String(id).trim().toLowerCase(), id]));
  const result = new Map(employeeIds.map((id) => [id, []]));
  const groups = new Map();
  for (const punch of punches) {
    const id = ids.get(String(punch.empCode).trim().toLowerCase());
    if (!id || !Number.isFinite(stamp(punch.punchTime || ''))) continue;
    const date = punch.punchTime.slice(0, 10);
    const key = `${id}|${date}`;
    if (!groups.has(key)) groups.set(key, { id, date, punches: [] });
    groups.get(key).punches.push({ punchTime: punch.punchTime, device: punch.device || '' });
  }
  for (const group of groups.values()) {
    group.punches.sort((a, b) => stamp(a.punchTime) - stamp(b.punchTime));
    const accepted = distinctScans(group.punches);
    const first = accepted[0];
    const last = accepted.length > 1 ? accepted.at(-1) : null;
    result.get(group.id).push({ date: group.date, checkIn: first.punchTime.slice(11, 19), checkOut: last?.punchTime.slice(11, 19) || '', deviceIn: first.device, deviceOut: last?.device || '', scans: accepted.length, punches: group.punches });
  }
  result.forEach((days) => days.sort((a, b) => a.date.localeCompare(b.date)));
  return result;
}

function distinctScans(scans) {
  return scans.reduce((kept, scan) => {
    if (!kept.length || stamp(scan.punchTime) - stamp(kept.at(-1).punchTime) >= 2 * 60 * 60 * 1000) kept.push(scan);
    return kept;
  }, []);
}

export function workDaysFromScans(days, employeeId, shiftFor) {
  const scans = days.flatMap((day) => Array.isArray(day.punches) ? day.punches : [
    day.checkIn && { punchTime: `${day.date} ${day.checkIn.padEnd(8, ':00')}`, device: day.deviceIn || '' },
    day.checkOut && { punchTime: `${day.date} ${day.checkOut.padEnd(8, ':00')}`, device: day.deviceOut || '' },
  ].filter(Boolean)).sort((a, b) => stamp(a.punchTime) - stamp(b.punchTime));
  const groups = new Map();
  for (const scan of distinctScans(scans)) {
    const date = scan.punchTime.slice(0, 10);
    const time = minutes(scan.punchTime.slice(11));
    const prior = nextDate(date, -1);
    const previousShift = shiftFor(employeeId, prior);
    const currentShift = shiftFor(employeeId, date);
    let workDate = date;
    // Split the rest interval halfway between the night shift's end and its next start.
    if (night(previousShift) && time < (minutes(previousShift.endTime) + minutes(previousShift.startTime)) / 2) workDate = prior;
    else if (night(currentShift) && time < (minutes(currentShift.endTime) + minutes(currentShift.startTime)) / 2) continue;
    if (!groups.has(workDate)) groups.set(workDate, []);
    groups.get(workDate).push(scan);
  }
  return [...groups].map(([date, punches]) => {
    const first = punches[0];
    const last = punches.length > 1 ? punches.at(-1) : null;
    const assigned = shiftFor(employeeId, date);
    // An isolated morning checkout must never become a night-shift check-in.
    const onlyCheckout = night(assigned) && first.punchTime.slice(0, 10) > date;
    return { date, checkIn: onlyCheckout ? '' : first.punchTime.slice(11, 19), checkOut: (onlyCheckout ? punches.at(-1) : last)?.punchTime.slice(11, 19) || '', deviceIn: onlyCheckout ? '' : first.device, deviceOut: (onlyCheckout ? punches.at(-1) : last)?.device || '', scans: punches.length };
  });
}

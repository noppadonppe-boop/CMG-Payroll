export const bangkokDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

export function wageRequestMonth(entry) {
  // Existing locally generated IDs preserve the creation time of older requests.
  const timestamp = /^wage-(\d{13})-/.exec(entry.id || '')?.[1];
  const created = entry.createdAt || (timestamp ? Number(timestamp) : null);
  return created && !Number.isNaN(new Date(created).getTime())
    ? bangkokDate(created).slice(0, 7)
    : String(entry.date || '').slice(0, 7);
}

export function wagePeriodForDate(periods, date) {
  return periods.find((period) => period.startDate <= date && period.endDate >= date) || null;
}

export function wagePeriodBounds(date) {
  const [year, month, day] = date.split('-').map(Number);
  const prefix = date.slice(0, 7);
  return {
    startDate: `${prefix}-${day <= 15 ? '01' : '16'}`,
    endDate: `${prefix}-${day <= 15 ? '15' : new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
  };
}

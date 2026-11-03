export const priorWagePeriod = (periods, period) => !period?.startDate ? null : [...periods]
  .filter((item) => item.id !== period.id && item.startDate && item.endDate && item.endDate < period.startDate)
  .sort((a, b) => b.endDate.localeCompare(a.endDate))[0] || null;

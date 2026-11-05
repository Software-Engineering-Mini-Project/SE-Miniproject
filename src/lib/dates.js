export function resolveToday(value, now = new Date()) {
  const utc = now.toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return utc;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && Math.abs(date - Date.parse(utc + 'T00:00:00.000Z')) <= 86400000 ? value : utc;
}

export function localToday(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

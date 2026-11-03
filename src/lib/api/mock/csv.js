// CSV serialisation with formula-injection protection (SRS TM-F-042, PRJ-SR-005).
// The real backend must apply the same policy; this mirrors it for the mock API.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formulas and quotes separators, quotes and newlines. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

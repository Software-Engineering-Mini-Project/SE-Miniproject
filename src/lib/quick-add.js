/**
 * Quick add: turn one line of text into a task.
 *
 *   "Fix the login redirect tomorrow !high @mina"
 *     → { title: 'Fix the login redirect', dueDate: <tomorrow>, priority: 'High', assigneeIds: [mina] }
 *
 * Recognised anywhere in the line (case-insensitive):
 *   priority   !high !h !1 · !medium !med !m !2 · !low !l !3
 *   assignee   @name: a member's first name, full name without spaces, or email local part
 *              (a unique prefix is enough); @me is the current user
 *   due date   today · tomorrow (tmr) · mon … sunday (the next one, never today) · next week
 *              (next Monday) · in 3 days · in 2 weeks · 20 nov · nov 20 · 2026-11-20,
 *              optionally led by "due", "by" or "on"
 *
 * Every recognised piece is reported with its source text, so the UI can preview it and let
 * the person keep a word as plain text (`keep`), e.g. "Review the Monday report".
 * Pure; dates are calendar dates (YYYY-MM-DD) relative to `today`.
 */

const PRIORITIES = {
  high: 'High', h: 'High', 1: 'High',
  medium: 'Medium', med: 'Medium', m: 'Medium', 2: 'Medium',
  low: 'Low', l: 'Low', 3: 'Low',
};
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (date, days) => fromDayNumber(dayNumber(date) + days);
const weekdayOf = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** A day and month with no year: this year, or next year if that date has already passed. */
function nextDayMonth(today, month, day) {
  const year = Number(today.slice(0, 4));
  const thisYear = validDate(year, month, day);
  if (thisYear && thisYear >= today) return thisYear;
  return validDate(year + 1, month, day);
}

const monthIndex = (word) => MONTHS.indexOf(word.slice(0, 3).toLowerCase());
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_WORD = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const LEAD = '(?:(?:due|by|on)\\s+)?';

/** Date phrases, most specific first. Each returns a YYYY-MM-DD or null. */
const DATE_RULES = [
  [new RegExp(`${LEAD}(\\d{4})-(\\d{2})-(\\d{2})`, 'i'), (m) => validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))],
  [new RegExp(`${LEAD}in\\s+(\\d{1,3})\\s+(days?|weeks?)`, 'i'), (m, today) => addDays(today, Number(m[1]) * (/^w/i.test(m[2]) ? 7 : 1))],
  [new RegExp(`${LEAD}next\\s+week`, 'i'), (_m, today) => addDays(today, ((8 - weekdayOf(today)) % 7) || 7)],
  [new RegExp(`${LEAD}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}`, 'i'), (m, today) => nextDayMonth(today, monthIndex(m[2]), Number(m[1]))],
  [new RegExp(`${LEAD}${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i'), (m, today) => nextDayMonth(today, monthIndex(m[1]), Number(m[2]))],
  [new RegExp(`${LEAD}(today|tod)`, 'i'), (_m, today) => today],
  [new RegExp(`${LEAD}(tomorrow|tmrw?)`, 'i'), (_m, today) => addDays(today, 1)],
  [new RegExp(`${LEAD}(?:next\\s+)?${WEEKDAY_WORD}`, 'i'), (m, today) => {
    const target = WEEKDAYS[m[1].slice(0, 3).toLowerCase()];
    return addDays(today, ((target - weekdayOf(today) + 7) % 7) || 7);
  }],
];

/** Whole-word match: the phrase must be bounded by whitespace or the ends of the line. */
function findWhole(text, pattern, taken) {
  const source = new RegExp(`(^|\\s)(${pattern.source})(?=\\s|$)`, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(source)) {
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    // Re-run the inner pattern on the phrase to get its own groups.
    const inner = match[2].match(new RegExp(`^${pattern.source}$`, pattern.flags.replace('g', '')));
    return { start, end, text: match[2], groups: inner };
  }
  return null;
}

const compact = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Members a handle could mean: exact first name / full name / email local part, else a unique prefix. */
export function matchMember(handle, members, currentUserId) {
  const key = compact(handle);
  if (!key) return null;
  if (key === 'me') return members.find((member) => member.id === currentUserId) || null;
  const names = (member) => [
    compact(member.name.split(/\s+/)[0] || ''),
    compact(member.name),
    compact((member.email || '').split('@')[0]),
  ];
  const exact = members.filter((member) => names(member).includes(key));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefixed = members.filter((member) => names(member).some((name) => name.startsWith(key)));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * @param {string} text
 * @param {{ today: string, members?: Array<{ id: string, name: string, email?: string }>, currentUserId?: string, keep?: Iterable<string> }} options
 *   `members` are the people who can be assigned; `keep` lists source phrases to leave in the title.
 * @returns {{
 *   title: string, priority: string | null, dueDate: string | null, assigneeIds: string[],
 *   parts: Array<{ kind: 'priority' | 'due' | 'assignee', text: string, value: string, label?: string }>,
 *   unknownHandles: string[],
 * }}
 */
export function parseQuickAdd(text, { today, members = [], currentUserId, keep = [] } = {}) {
  const kept = new Set([...keep].map((phrase) => phrase.toLowerCase()));
  const taken = [];
  const parts = [];
  const unknownHandles = [];
  let priority = null;
  let dueDate = null;
  const assigneeIds = [];

  const claim = (found) => {
    if (!found || kept.has(found.text.toLowerCase())) return false;
    taken.push([found.start, found.end]);
    return true;
  };

  // Priority: the first !word wins; later ones stay as text.
  for (const match of text.matchAll(/(^|\s)(!([\p{L}\d]+))(?=\s|$)/gu)) {
    const value = PRIORITIES[match[3].toLowerCase()];
    const found = { start: match.index + match[1].length, end: match.index + match[1].length + match[2].length, text: match[2] };
    if (!value || priority || !claim(found)) continue;
    priority = value;
    parts.push({ kind: 'priority', text: found.text, value });
  }

  // Assignees: every @handle that names exactly one assignable member.
  for (const match of text.matchAll(/(^|\s)(@([\p{L}\p{N}._-]+))(?=\s|$)/gu)) {
    const found = { start: match.index + match[1].length, end: match.index + match[1].length + match[2].length, text: match[2] };
    if (kept.has(found.text.toLowerCase())) continue;
    const member = matchMember(match[3], members, currentUserId);
    if (!member) {
      unknownHandles.push(found.text);
      continue;
    }
    claim(found);
    if (!assigneeIds.includes(member.id)) {
      assigneeIds.push(member.id);
      parts.push({ kind: 'assignee', text: found.text, value: member.id, label: member.name });
    }
  }

  // Due date: the first recognised phrase, trying the most specific rules first.
  if (today) {
    for (const [pattern, resolve] of DATE_RULES) {
      const found = findWhole(text, pattern, taken);
      if (!found || kept.has(found.text.toLowerCase())) continue;
      const value = resolve(found.groups, today);
      if (!value) continue;
      claim(found);
      dueDate = value;
      parts.push({ kind: 'due', text: found.text, value });
      break;
    }
  }

  let title = '';
  let cursor = 0;
  for (const [start, end] of [...taken].sort((a, b) => a[0] - b[0])) {
    title += `${text.slice(cursor, start)} `;
    cursor = end;
  }
  title = `${title}${text.slice(cursor)}`.replace(/\s+/g, ' ').trim();

  return { title, priority, dueDate, assigneeIds, parts, unknownHandles };
}

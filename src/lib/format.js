// Display helpers. Dates in fixtures/API are ISO date-only strings for due dates.

const DAY = 24 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Parses 'YYYY-MM-DD' as a local calendar date. */
export function parseDueDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isOverdue(task) {
  if (!task?.dueDate || task.status === 'Done') return false;
  return parseDueDate(task.dueDate) < startOfToday();
}

/** Days from today until the due date (negative when past). */
export function daysUntil(dueDate) {
  const due = parseDueDate(dueDate);
  if (!due) return null;
  return Math.round((due - startOfToday()) / DAY);
}

export function formatDue(dueDate) {
  const days = daysUntil(dueDate);
  if (days === null) return 'No due date';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return 'Due yesterday';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days < 7) return `Due in ${days} days`;
  const due = parseDueDate(dueDate);
  return `Due ${due.getFullYear() === new Date().getFullYear() ? dateFmt.format(due) : dateYearFmt.format(due)}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return dateYearFmt.format(new Date(iso));
}

export function formatRelative(iso) {
  const then = new Date(iso);
  const diff = Date.now() - then.getTime();
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < DAY && then.getDate() === new Date().getDate()) return `today at ${timeFmt.format(then)}`;
  if (diff < 2 * DAY) return `yesterday at ${timeFmt.format(then)}`;
  return dateFmt.format(then);
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || name;
}

export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

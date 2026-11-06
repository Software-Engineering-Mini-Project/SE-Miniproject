/**
 * The "Upcoming" agenda: open tasks grouped by when they are due, nearest first.
 * Overdue · Today · Tomorrow · each of the next five days · Later · No due date.
 * Done tasks are left out; empty groups are dropped. Pure; dates are YYYY-MM-DD.
 */

const DAY_MS = 86_400_000;
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

const byPriorityThenTitle = (a, b) =>
  (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/**
 * @param {Array<{ id: string, title: string, status: string, priority?: string, dueDate?: string | null }>} tasks
 * @param {string} today
 * @returns {Array<{ key: string, label: string, date?: string, tone?: 'overdue', tasks: object[] }>}
 */
export function groupUpcoming(tasks, today) {
  const todayN = dayNumber(today);
  const groups = new Map();
  const add = (key, make, task) => {
    if (!groups.has(key)) groups.set(key, { ...make(), tasks: [] });
    groups.get(key).tasks.push(task);
  };

  for (const task of tasks) {
    if (task.status === 'Done') continue;
    if (!task.dueDate) {
      add('none', () => ({ key: 'none', label: 'No due date', order: Infinity }), task);
      continue;
    }
    const offset = dayNumber(task.dueDate) - todayN;
    if (offset < 0) add('overdue', () => ({ key: 'overdue', label: 'Overdue', tone: 'overdue', order: -1 }), task);
    else if (offset === 0) add(task.dueDate, () => ({ key: 'today', label: 'Today', date: task.dueDate, order: 0 }), task);
    else if (offset === 1) add(task.dueDate, () => ({ key: 'tomorrow', label: 'Tomorrow', date: task.dueDate, order: 1 }), task);
    else if (offset < 7) {
      add(task.dueDate, () => ({ key: task.dueDate, label: weekdayFmt.format(new Date(`${task.dueDate}T00:00:00Z`)), date: task.dueDate, order: offset }), task);
    } else add('later', () => ({ key: 'later', label: 'Later', order: 7 }), task);
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...group }) => ({
      ...group,
      // Overdue and later work: earliest due first. A single day: most important first.
      tasks: group.date
        ? group.tasks.sort(byPriorityThenTitle)
        : group.tasks.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || byPriorityThenTitle(a, b)),
    }));
}

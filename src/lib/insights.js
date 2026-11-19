// Pure aggregations behind the dashboard and project insight charts. Dates are local
// calendar days as YYYY-MM-DD strings, so plain string comparison orders them.

import { TASK_PRIORITIES, TASK_STATUSES } from './constants.js';

export const UNASSIGNED_ID = '__unassigned__';

function addDays(day, count) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d + count);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/** Open (not Done) tasks grouped by when they are due, in reading order. */
export function dueBuckets(tasks, today) {
  const weekEnd = addDays(today, 7);
  const buckets = [
    { key: 'overdue', label: 'Overdue', count: 0 },
    { key: 'today', label: 'Today', count: 0 },
    { key: 'week', label: 'Next 7 days', count: 0 },
    { key: 'later', label: 'Later', count: 0 },
    { key: 'none', label: 'No due date', count: 0 },
  ];
  const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]));
  for (const task of tasks) {
    if (task.status === 'Done') continue;
    const due = task.dueDate;
    const key = !due ? 'none' : due < today ? 'overdue' : due === today ? 'today' : due <= weekEnd ? 'week' : 'later';
    byKey[key].count += 1;
  }
  return buckets;
}

/** Open tasks per priority, High first. */
export function priorityCounts(tasks) {
  return TASK_PRIORITIES.map((priority) => ({
    key: priority,
    label: priority,
    count: tasks.filter((task) => task.status !== 'Done' && task.priority === priority).length,
  }));
}

/**
 * Tasks per member split by status, busiest (most open work) first. A task with two assignees
 * counts for both; tasks nobody owns form an "Unassigned" row at the end.
 */
export function workloadByMember(tasks, members, today) {
  const rows = new Map(members.map((member) => [member.id, { id: member.id, name: member.name, member, counts: emptyCounts(), overdue: 0, total: 0 }]));
  const unassigned = { id: UNASSIGNED_ID, name: 'Unassigned', member: null, counts: emptyCounts(), overdue: 0, total: 0 };
  for (const task of tasks) {
    const targets = task.assigneeIds.length ? task.assigneeIds.map((id) => rows.get(id)).filter(Boolean) : [unassigned];
    for (const row of targets) {
      row.counts[task.status] = (row.counts[task.status] ?? 0) + 1;
      row.total += 1;
      if (task.status !== 'Done' && task.dueDate && task.dueDate < today) row.overdue += 1;
    }
  }
  const open = (row) => row.total - row.counts.Done;
  const sorted = [...rows.values()].sort((a, b) => open(b) - open(a) || b.total - a.total || a.name.localeCompare(b.name));
  return unassigned.total ? [...sorted, unassigned] : sorted;
}

function emptyCounts() {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
}

/** Share of tasks that are Done, as a whole percentage (0 when there are no tasks). */
export function completionPercent(tasks) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((task) => task.status === 'Done').length / tasks.length) * 100);
}

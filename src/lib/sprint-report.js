/**
 * Burndown, sprint report and velocity (issue #77), worked out from the activity history so the
 * numbers match it: `sprint` entries say when a task entered or left a sprint, `status` entries
 * when it was finished or reopened. Shared by the API, the mock API and the UI. Pure functions.
 *
 * Inputs are plain objects: `sprint` (src/lib/sprints.js), the project's `tasks`, and the
 * `activities` of those tasks (only `sprint` and `status` entries matter). Times are ISO strings.
 * Days are calendar days in UTC, like the sprint's `startDate` and `endDate`.
 */
import { addDays, sprintLengthDays } from './sprints.js';

const time = (value) => (value ? new Date(value).getTime() : null);
const endOfDay = (day) => Date.parse(`${day}T23:59:59.999Z`);
const pointsOf = (task) => task.storyPoints ?? 0;

/** Entries of one action for one task, oldest first. */
function entriesOf(byTask, taskId, action) {
  return (byTask.get(taskId) ?? []).filter((entry) => entry.action === action);
}

/**
 * Whether a task was in the sprint at moment `at`. The last `sprint` entry before `at` decides;
 * with none before, the first one after says where it came from; with none at all, where the
 * task is now (or, for a completed sprint, whether the report lists it).
 */
function inSprintAt(task, sprint, entries, at, fallback) {
  let before = null;
  let after = null;
  for (const entry of entries) {
    if (time(entry.createdAt) <= at) before = entry;
    else if (!after) after = entry;
  }
  if (before) return before.details?.to === sprint.id;
  if (after) return after.details?.from === sprint.id;
  return fallback;
}

/** Whether a task was finished at moment `at`, from its `status` entries, else its `completedAt`. */
function doneAt(task, entries, at) {
  let before = null;
  let after = null;
  for (const entry of entries) {
    if (time(entry.createdAt) <= at) before = entry;
    else if (!after) after = entry;
  }
  if (before) return before.details?.to === 'Done';
  if (after) return after.details?.from === 'Done';
  if (task.completedAt) return time(task.completedAt) <= at;
  return false;
}

/**
 * Everything the report and the burndown need about one sprint. `today` (YYYY-MM-DD) ends the
 * burndown of a sprint that is still running.
 */
export function buildSprintReport({ sprint, tasks, activities = [], today }) {
  const byTask = new Map();
  for (const entry of [...activities].sort((a, b) => time(a.createdAt) - time(b.createdAt))) {
    if (entry.action !== 'sprint' && entry.action !== 'status') continue;
    if (!byTask.has(entry.taskId)) byTask.set(entry.taskId, []);
    byTask.get(entry.taskId).push(entry);
  }
  const reported = new Set([...(sprint.report?.completed?.taskIds ?? []), ...(sprint.report?.unfinished?.taskIds ?? [])]);
  const committedIds = new Set(sprint.committed?.taskIds ?? []);
  // Every task that was ever in this sprint.
  const candidates = tasks.filter((task) => task.sprintId === sprint.id
    || committedIds.has(task.id)
    || reported.has(task.id)
    || entriesOf(byTask, task.id, 'sprint').some((entry) => entry.details?.to === sprint.id || entry.details?.from === sprint.id));
  const membership = (task, at) => inSprintAt(task, sprint, entriesOf(byTask, task.id, 'sprint'), at,
    sprint.state === 'completed' ? reported.has(task.id) : task.sprintId === sprint.id);
  const finished = (task, at) => doneAt(task, entriesOf(byTask, task.id, 'status'), at);

  const unit = candidates.some((task) => pointsOf(task) > 0) ? 'points' : 'items';
  const size = (task) => (unit === 'points' ? pointsOf(task) : 1);
  const startAt = time(sprint.startedAt) ?? Date.parse(`${sprint.startDate}T00:00:00.000Z`);
  const closeAt = sprint.state === 'completed' ? time(sprint.completedAt) : null;

  // Committed: what the sprint held when it started (recorded then; else worked out).
  const committed = sprint.committed
    ? candidates.filter((task) => committedIds.has(task.id))
    : candidates.filter((task) => membership(task, startAt));
  // Added during the sprint: entered after it started (and before it completed).
  const added = candidates.filter((task) => !committedIds.has(task.id) && entriesOf(byTask, task.id, 'sprint')
    .some((entry) => entry.details?.to === sprint.id && time(entry.createdAt) > startAt && (closeAt === null || time(entry.createdAt) < closeAt)));
  // Taken out during the sprint (not by completing it).
  const removed = candidates.filter((task) => entriesOf(byTask, task.id, 'sprint')
    .some((entry) => entry.details?.from === sprint.id && time(entry.createdAt) > startAt && (closeAt === null || time(entry.createdAt) < closeAt)));

  let completed;
  let carriedOver;
  if (sprint.state === 'completed' && sprint.report) {
    completed = candidates.filter((task) => sprint.report.completed.taskIds.includes(task.id));
    carriedOver = candidates.filter((task) => sprint.report.unfinished.taskIds.includes(task.id));
  } else {
    const now = sprint.state === 'active' ? Infinity : startAt;
    const current = candidates.filter((task) => membership(task, now));
    completed = current.filter((task) => finished(task, now));
    carriedOver = [];
  }

  // Burndown: remaining work at the end of each day, and the ideal straight line.
  const days = [];
  if (sprint.state !== 'planned' && sprint.startDate && sprint.endDate) {
    const length = sprintLengthDays(sprint.startDate, sprint.endDate);
    const startTotal = committed.reduce((sum, task) => sum + size(task), 0);
    const lastDay = sprint.state === 'completed' ? sprint.endDate : (today && today < sprint.endDate ? today : sprint.endDate);
    for (let index = 0; index < length; index += 1) {
      const day = addDays(sprint.startDate, index);
      const ideal = length > 1 ? Math.round((startTotal * (1 - index / (length - 1))) * 10) / 10 : 0;
      let remaining = null;
      if (day <= lastDay) {
        // A completed sprint's last moment is its completion: later moves don't count.
        const at = closeAt !== null && endOfDay(day) >= closeAt ? closeAt - 1 : endOfDay(day);
        remaining = candidates.filter((task) => membership(task, at) && !finished(task, at)).reduce((sum, task) => sum + size(task), 0);
      }
      days.push({ date: day, remaining, ideal });
    }
  }

  const summary = (list) => ({ taskIds: list.map((task) => task.id), count: list.length, points: list.reduce((sum, task) => sum + pointsOf(task), 0) });
  return {
    sprintId: sprint.id,
    unit,
    days,
    committed: summary(committed),
    added: summary(added),
    removed: summary(removed),
    completed: summary(completed),
    carriedOver: { ...summary(carriedOver), movedTo: sprint.report?.movedTo ?? null },
  };
}

/**
 * Points (and items) finished per completed sprint, oldest first, the last `limit` of them, with
 * the average of the last three: what the team can expect to finish in a sprint.
 */
export function velocity(sprints, { limit = 6 } = {}) {
  const done = sprints
    .filter((sprint) => sprint.state === 'completed' && sprint.report)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
    .slice(-limit)
    .map((sprint) => ({
      id: sprint.id,
      name: sprint.name,
      committedPoints: sprint.committed?.points ?? 0,
      completedPoints: sprint.report.completed.points,
      completedCount: sprint.report.completed.count,
    }));
  const recent = done.slice(-3);
  const average = recent.length ? Math.round((recent.reduce((sum, item) => sum + item.completedPoints, 0) / recent.length) * 10) / 10 : null;
  return { sprints: done, average };
}

/**
 * How many sprints the open work takes at the team's velocity (points per sprint): the forecast
 * by velocity, next to the forecast by throughput (src/lib/forecast.js). Null without velocity.
 */
export function velocityForecast({ average, remainingPoints, unestimated = 0 }) {
  if (!average || average <= 0) return null;
  return { sprints: remainingPoints > 0 ? Math.ceil(remainingPoints / average) : 0, remainingPoints, unestimated, average };
}

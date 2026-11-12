/**
 * Backlog and sprints (issue #76): sprint fields and their rules, backlog ranking and what
 * completing a sprint does. Shared by the API, the mock API and the UI. Pure functions only.
 *
 * A sprint is planned, then active, then completed. A project has at most one active sprint.
 * A task belongs to one sprint (`task.sprintId`) or to the backlog (`sprintId: null`); `task.rank`
 * orders tasks within a project (lower comes first), the same order in the backlog and in sprints.
 */

export const SPRINT_STATES = ['planned', 'active', 'completed'];
export const SPRINT_STATE_LABELS = { planned: 'Planned', active: 'Active', completed: 'Completed' };
export const SPRINT_NAME_MAX = 80;
export const SPRINT_GOAL_MAX = 500;
export const SPRINT_LENGTH_DAYS = 14;
/** Gap between neighbouring ranks; a task dropped between two others takes the midpoint. */
export const RANK_STEP = 1024;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (YYYY-MM-DD), inclusive of both: a one-day sprint is 1. */
export function sprintLengthDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

/**
 * Reads the sprint fields in a create or update body: `{ values, errors }`, like readWorkItemFields.
 * On create, start and end dates are required (the name may be left out; the server picks one).
 * `current` is the sprint being edited, so a new end date is checked against the old start date.
 */
export function readSprintFields(body = {}, { create = false, current = null } = {}) {
  const values = {};
  const errors = {};
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') errors.name = 'Name must be text.';
    else if (!body.name.trim()) errors.name = 'Give the sprint a name.';
    else if (body.name.trim().length > SPRINT_NAME_MAX) errors.name = `Use ${SPRINT_NAME_MAX} characters or fewer.`;
    else values.name = body.name.trim();
  } else if (body.name === null) errors.name = 'Give the sprint a name.';
  if (body.goal !== undefined) {
    if (body.goal !== null && typeof body.goal !== 'string') errors.goal = 'Goal must be text.';
    else if ((body.goal ?? '').trim().length > SPRINT_GOAL_MAX) errors.goal = `Use ${SPRINT_GOAL_MAX} characters or fewer.`;
    else values.goal = (body.goal ?? '').trim();
  } else if (create) values.goal = '';
  for (const [field, missing] of [['startDate', 'Choose a start date.'], ['endDate', 'Choose an end date.']]) {
    if (body[field] === undefined) {
      if (create) errors[field] = missing;
    } else if (!isDateOnly(body[field])) errors[field] = 'Enter a valid date.';
    else values[field] = body[field];
  }
  const start = values.startDate ?? current?.startDate;
  const end = values.endDate ?? current?.endDate;
  if (!errors.startDate && !errors.endDate && start && end && end < start) errors.endDate = 'The sprint must end on or after its start date.';
  return { values, errors };
}

/** Orders tasks for the backlog and sprints: by rank, unranked last (oldest first), then id. */
export function compareRank(a, b) {
  const ra = typeof a.rank === 'number' ? a.rank : null;
  const rb = typeof b.rank === 'number' ? b.rank : null;
  if (ra !== null && rb !== null && ra !== rb) return ra - rb;
  if (ra === null && rb !== null) return 1;
  if (ra !== null && rb === null) return -1;
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id));
}

export const byRank = (tasks) => [...tasks].sort(compareRank);

/**
 * The rank for a task placed between `previous` and `next` (their ranks, or null at either end).
 * `crowded` is true when the gap is too small to split again: renumber the project first.
 */
export function rankBetween(previous, next) {
  if (previous == null && next == null) return { rank: RANK_STEP, crowded: false };
  if (previous == null) return { rank: next - RANK_STEP, crowded: false };
  if (next == null) return { rank: previous + RANK_STEP, crowded: false };
  const rank = (previous + next) / 2;
  return { rank, crowded: !(next - previous > 1e-6) || rank <= previous || rank >= next };
}

/** Ranks 1024, 2048, ... for `tasks` in their current order: `[{ id, rank }]`. */
export function renumberRanks(tasks) {
  return byRank(tasks).map((task, index) => ({ id: task.id, rank: (index + 1) * RANK_STEP }));
}

/** The rank for a new task: after every other task in the project, so it joins the bottom of the backlog. */
export function nextRank(tasks) {
  const ranks = tasks.map((task) => task.rank).filter((rank) => typeof rank === 'number');
  return (ranks.length ? Math.max(...ranks) : 0) + RANK_STEP;
}

/** Items, finished items and story points of a set of tasks (a sprint, a report, the backlog). */
export function sprintTotals(tasks) {
  const points = (list) => list.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);
  const done = tasks.filter((task) => task.status === 'Done');
  return { count: tasks.length, done: done.length, points: points(tasks), donePoints: points(done) };
}

/** What starting a sprint commits to: its tasks and their points at that moment. */
export function commitmentOf(tasks) {
  return { taskIds: tasks.map((task) => task.id), points: sprintTotals(tasks).points };
}

/**
 * What completing a sprint does with its tasks (`tasks`: the sprint's tasks now). Finished ones
 * stay in the sprint as its record; unfinished ones move to `moveTo` (a sprint id, or null for the
 * backlog). The report keeps both lists with their counts and points.
 */
export function completionPlan(tasks, moveTo = null) {
  const finished = tasks.filter((task) => task.status === 'Done');
  const unfinished = tasks.filter((task) => task.status !== 'Done');
  const part = (list) => ({ taskIds: list.map((task) => task.id), count: list.length, points: sprintTotals(list).points });
  return { moveIds: unfinished.map((task) => task.id), report: { completed: part(finished), unfinished: part(unfinished), movedTo: moveTo ?? null } };
}

/**
 * Why `sprint` (or the backlog, when null) cannot take tasks right now, or null when it can.
 * Tasks join planned and active sprints of the same project, never completed ones.
 */
export function sprintTargetError(sprint, projectId) {
  if (!sprint || String(sprint.projectId) !== String(projectId)) return 'Choose a sprint from this project.';
  if (sprint.state === 'completed') return 'That sprint is complete. Choose a planned or active sprint, or the backlog.';
  return null;
}

/** "ALPHA Sprint 3" (or the project name when it has no key). */
export const sprintName = ({ projectKey, projectName, number }) => `${projectKey || projectName || 'Project'} Sprint ${number}`;

/** The name and dates suggested for a new sprint: "ALPHA Sprint 3", two weeks after the last one. */
export function nextSprintDefaults({ sprints = [], projectKey = null, projectName = '', today }) {
  const number = sprints.reduce((max, sprint) => Math.max(max, sprint.number ?? 0), 0) + 1;
  const latestEnd = sprints.filter((sprint) => sprint.state !== 'completed').map((sprint) => sprint.endDate).filter(Boolean).sort().at(-1);
  const startDate = latestEnd && addDays(latestEnd, 1) > today ? addDays(latestEnd, 1) : today;
  return {
    name: sprintName({ projectKey, projectName, number }),
    startDate,
    endDate: addDays(startDate, SPRINT_LENGTH_DAYS - 1),
  };
}

/** Sprints in the order the backlog shows them: active, then planned by start date, then completed (newest first). */
export function orderSprints(sprints) {
  const order = { active: 0, planned: 1, completed: 2 };
  return [...sprints].sort((a, b) => {
    if (a.state !== b.state) return order[a.state] - order[b.state];
    if (a.state === 'completed') return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')) || (b.number ?? 0) - (a.number ?? 0);
    return String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')) || (a.number ?? 0) - (b.number ?? 0);
  });
}

/** Whether a task reopened from a completed sprint goes back to the backlog (it no longer belongs to that record). */
export const leavesCompletedSprint = (sprint, fromStatus, toStatus) => sprint?.state === 'completed' && fromStatus === 'Done' && toStatus !== 'Done';

import bcrypt from 'bcryptjs';
import fixtureComments from '../../fixtures/comments.json' with { type: 'json' };
import fixtureOrganisations from '../../fixtures/organisations.json' with { type: 'json' };
import fixtureNotifications from '../../fixtures/notifications.json' with { type: 'json' };
import fixtureProjects from '../../fixtures/projects.json' with { type: 'json' };
import fixtureSprints from '../../fixtures/sprints.json' with { type: 'json' };
import fixtureTasks from '../../fixtures/tasks.json' with { type: 'json' };
import fixtureUsers from '../../fixtures/users.json' with { type: 'json' };
import { Activity, Comment, models, Notification, Organisation, Project, Sprint, Task, User } from '../models/index.js';
import { seedActivities } from '../../src/lib/activity.js';
import { BCRYPT_COST } from './password.js';
import { numberTasks } from '../../src/lib/work-items.js';

export const FIXTURE_PASSWORD = 'Password123!';
// The fixtures were written as if "today" were this date; `shiftDays` moves them to another day.
export const FIXTURE_ANCHOR_DATE = '2026-10-14';
const DAY_MS = 86_400_000;

/** Whole days from the fixture anchor to `today` (YYYY-MM-DD, UTC). */
export function daysSinceFixtureAnchor(today) {
  return Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${FIXTURE_ANCHOR_DATE}T00:00:00.000Z`)) / DAY_MS);
}

function shiftDateOnly(value, days) {
  if (!value || !days) return value;
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function shiftTimestamp(value, days) {
  if (!value || !days) return value;
  return new Date(Date.parse(value) + days * DAY_MS).toISOString();
}

function shiftRecord(record, days) {
  if (!days) return record;
  const shifted = { ...record };
  for (const key of ['createdAt', 'updatedAt', 'completedAt', 'startedAt']) if (shifted[key]) shifted[key] = shiftTimestamp(shifted[key], days);
  for (const key of ['dueDate', 'startDate', 'endDate']) if (key in shifted) shifted[key] = shiftDateOnly(shifted[key], days);
  return shifted;
}

// Completed work from the six weeks before the anchor date, so a demo project has the throughput
// history the delivery forecast needs. Deterministic: [project, days before anchor, assignee].
const HISTORY = [
  ['project-alpha', 40, 'user-member-001'], ['project-alpha', 37, 'user-lead-001'], ['project-alpha', 33, 'user-member-002'],
  ['project-alpha', 30, 'user-member-001'], ['project-alpha', 26, 'user-member-001'], ['project-alpha', 23, 'user-member-002'],
  ['project-alpha', 19, 'user-lead-001'], ['project-alpha', 16, 'user-member-001'], ['project-alpha', 12, 'user-member-002'],
  ['project-alpha', 9, 'user-member-001'], ['project-alpha', 5, 'user-lead-001'], ['project-alpha', 2, 'user-member-002'],
  ['project-beta', 35, 'user-lead-001'], ['project-beta', 21, 'user-admin-001'], ['project-beta', 8, 'user-lead-001'],
];
const HISTORY_TITLES = [
  'Write the sign-in error messages', 'Set up the CI pipeline', 'Add the empty states', 'Draft the project form',
  'Wire the notification badge', 'Add keyboard focus styles', 'Write the seed script', 'Add the CSV export',
  'Fix the drawer focus trap', 'Tune the dashboard queries', 'Add task filters', 'Review the access matrix',
  'Collect accessibility evidence', 'Write the release notes', 'Run the load test',
];

/** The demo history as fixture-shaped task records (dates relative to the fixture anchor). */
export function historyTasks() {
  const anchor = Date.parse(`${FIXTURE_ANCHOR_DATE}T16:00:00.000Z`);
  return HISTORY.map(([projectId, daysAgo, assignee], index) => {
    const completedAt = new Date(anchor - daysAgo * DAY_MS).toISOString();
    const createdAt = new Date(anchor - (daysAgo + 4 + (index % 5)) * DAY_MS).toISOString();
    return {
      id: `task-history-${String(index + 1).padStart(2, '0')}`,
      title: HISTORY_TITLES[index],
      description: 'Completed earlier (demo history for the delivery forecast).',
      status: 'Done',
      priority: ['Medium', 'High', 'Low'][index % 3],
      dueDate: new Date(anchor - (daysAgo - 2) * DAY_MS).toISOString().slice(0, 10),
      projectId,
      assigneeIds: [assignee],
      completedAt,
      createdAt,
      updatedAt: completedAt,
    };
  });
}

/**
 * Replaces every collection with the synthetic fixtures. Destructive: test/demo databases only.
 * @param {{ shiftDays?: number, history?: boolean }} [options] `shiftDays` moves all fixture dates
 *   by this many days, so a demo database has a realistic mix of overdue, due-soon and later work
 *   relative to today; `history` adds six weeks of completed tasks for the delivery forecast.
 */
export async function seedDatabase({ shiftDays = 0, history = false } = {}) {
  await Promise.all(models.map((model) => model.deleteMany({})));
  // Fixture tasks are numbered first so their keys (ALPHA-1 ...) are the same with or without
  // the demo history, which takes the numbers after them.
  const fixtures = numberTasks(fixtureTasks);
  const extra = history ? numberTasks(historyTasks(), fixtures.counters) : { tasks: [], counters: fixtures.counters };
  const tasks = [...fixtures.tasks, ...extra.tasks].map((task) => shiftRecord(task, shiftDays));
  const comments = fixtureComments.map((comment) => shiftRecord(comment, shiftDays));
  const notifications = fixtureNotifications.map((notification) => shiftRecord(notification, shiftDays));
  const sprints = fixtureSprints.map((sprint) => shiftRecord(sprint, shiftDays));
  const sprintCounter = (projectId) => sprints.filter((sprint) => sprint.projectId === projectId).reduce((max, sprint) => Math.max(max, sprint.number), 0);
  const projects = fixtureProjects.map((project) => shiftRecord({ ...project, taskCounter: extra.counters[project.id] ?? 0, sprintCounter: sprintCounter(project.id) }, shiftDays));
  const users = fixtureUsers.map((user) => shiftRecord(user, shiftDays));

  const organisations = fixtureOrganisations.map((organisation) => shiftRecord(organisation, shiftDays));

  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, BCRYPT_COST);
  await Organisation.insertMany(organisations.map(({ id, ...organisation }) => ({ ...organisation, _id: id })));
  await User.insertMany(users.map(({ id, ...user }) => ({
    ...user,
    _id: id,
    emailNormalized: user.email.trim().toLowerCase(),
    passwordHash,
  })));
  await Project.insertMany(projects.map(({ id, ...project }) => ({ ...project, _id: id })));
  await Sprint.insertMany(sprints.map(({ id, ...sprint }) => ({ ...sprint, _id: id })));
  await Task.insertMany(tasks.map(({ id, ...task }) => ({ ...task, _id: id })));
  await Comment.insertMany(comments.map(({ id, ...comment }) => ({ ...comment, _id: id })));
  // A little history, so the Activity tab is not empty on a fresh database.
  await Activity.insertMany(seedActivities({ tasks, comments, projects, sprints }).map(({ id, ...entry }) => ({ ...entry, _id: id, updatedAt: entry.createdAt })));

  const taskProjects = new Map(tasks.map((task) => [task.id, task.projectId]));
  await Notification.insertMany(notifications.map(({ id, ...notification }) => {
    const task = tasks.find((item) => item.id === notification.taskId);
    return {
      ...notification,
      _id: id,
      projectId: notification.projectId ?? taskProjects.get(notification.taskId) ?? null,
      dedupeKey: notification.type === 'due-date' && task?.dueDate
        ? `${notification.taskId}:${task.dueDate}`
        : null,
    };
  }));

  return { organisations: organisations.length, users: users.length, projects: projects.length, sprints: sprints.length, tasks: tasks.length, comments: comments.length, notifications: notifications.length };
}

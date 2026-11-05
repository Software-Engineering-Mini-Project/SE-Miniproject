import bcrypt from 'bcryptjs';
import fixtureComments from '../../fixtures/comments.json' with { type: 'json' };
import fixtureNotifications from '../../fixtures/notifications.json' with { type: 'json' };
import fixtureProjects from '../../fixtures/projects.json' with { type: 'json' };
import fixtureTasks from '../../fixtures/tasks.json' with { type: 'json' };
import fixtureUsers from '../../fixtures/users.json' with { type: 'json' };
import { Comment, models, Notification, Project, Task, User } from '../models/index.js';
import { BCRYPT_COST } from './password.js';

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
  for (const key of ['createdAt', 'updatedAt']) if (shifted[key]) shifted[key] = shiftTimestamp(shifted[key], days);
  if ('dueDate' in shifted) shifted.dueDate = shiftDateOnly(shifted.dueDate, days);
  return shifted;
}

/**
 * Replaces every collection with the synthetic fixtures. Destructive: test/demo databases only.
 * @param {{ shiftDays?: number }} [options] move all fixture dates by this many days, so a demo
 *   database has a realistic mix of overdue, due-soon and later work relative to today.
 */
export async function seedDatabase({ shiftDays = 0 } = {}) {
  await Promise.all(models.map((model) => model.deleteMany({})));
  const tasks = fixtureTasks.map((task) => shiftRecord(task, shiftDays));
  const comments = fixtureComments.map((comment) => shiftRecord(comment, shiftDays));
  const notifications = fixtureNotifications.map((notification) => shiftRecord(notification, shiftDays));
  const projects = fixtureProjects.map((project) => shiftRecord(project, shiftDays));
  const users = fixtureUsers.map((user) => shiftRecord(user, shiftDays));

  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, BCRYPT_COST);
  await User.insertMany(users.map(({ id, ...user }) => ({
    ...user,
    _id: id,
    emailNormalized: user.email.trim().toLowerCase(),
    passwordHash,
  })));
  await Project.insertMany(projects.map(({ id, ...project }) => ({ ...project, _id: id })));
  await Task.insertMany(tasks.map(({ id, ...task }) => ({ ...task, _id: id })));
  await Comment.insertMany(comments.map(({ id, ...comment }) => ({ ...comment, _id: id })));

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

  return { users: users.length, projects: projects.length, tasks: tasks.length, comments: comments.length, notifications: notifications.length };
}

// completedAt: the completion timestamp the delivery forecast samples (src/lib/forecast.js).
// Stamped when a task enters Done, by any route; cleared when it leaves; untouched otherwise.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Task } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { historyTasks, seedDatabase } from '../utils/seed-database.js';
import { migrateCompletedAt } from '../utils/migrations.js';

const app = createApp({ jwtSecret: 'task-completion-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: () => {} });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;
let lead;

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  const response = await api().post('/api/auth/login').send({ email: 'lead@example.test', password: 'Password123!' });
  lead = response.body.token;
});
after(async () => { await database?.stop(); });

const recent = (iso) => Math.abs(Date.now() - Date.parse(iso)) < 60_000;

test('the status route stamps completedAt on Done and clears it when the task is reopened', async () => {
  const done = await api().patch('/api/tasks/task-001/status').set(auth(lead)).send({ status: 'Done' });
  assert.equal(done.status, 200, done.text);
  assert.ok(recent(done.body.completedAt), done.body.completedAt);
  assert.ok((await Task.findById('task-001').lean()).completedAt instanceof Date);

  // Setting Done again keeps the original completion time.
  const again = await api().patch('/api/tasks/task-001/status').set(auth(lead)).send({ status: 'Done' });
  assert.equal(again.body.completedAt, done.body.completedAt);

  const reopened = await api().patch('/api/tasks/task-001/status').set(auth(lead)).send({ status: 'In Progress' });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.completedAt, null);
  assert.equal((await Task.findById('task-001').lean()).completedAt, null);
});

test('a full update and a create keep completedAt in step with the status', async () => {
  const edited = await api().patch('/api/tasks/task-002').set(auth(lead)).send({ status: 'Done', title: 'Shipped' });
  assert.equal(edited.status, 200, edited.text);
  assert.ok(recent(edited.body.completedAt));

  // Editing something else leaves an existing completion time alone.
  const before = (await Task.findById('task-006').lean()).completedAt.toISOString();
  const renamed = await api().patch('/api/tasks/task-006').set(auth(lead)).send({ title: 'Renamed after completion' });
  assert.equal(renamed.body.completedAt, before);

  const reopened = await api().patch('/api/tasks/task-006').set(auth(lead)).send({ status: 'To Do' });
  assert.equal(reopened.body.completedAt, null);

  const created = await api().post('/api/projects/project-alpha/tasks').set(auth(lead)).send({ title: 'Logged after the fact', status: 'Done' });
  assert.equal(created.status, 201, created.text);
  assert.ok(recent(created.body.completedAt));
  const open = await api().post('/api/projects/project-alpha/tasks').set(auth(lead)).send({ title: 'Still to do' });
  assert.equal(open.body.completedAt, null);
});

test('completedAt is not client-writable', async () => {
  const response = await api().patch('/api/tasks/task-001').set(auth(lead)).send({ completedAt: '2020-01-01T00:00:00.000Z' });
  // Unknown fields are rejected or ignored; either way the stored value must not change.
  assert.ok([200, 400].includes(response.status), response.text);
  assert.equal((await Task.findById('task-001').lean()).completedAt, null);
});

test('the migration backfills Done tasks from updatedAt, once', async () => {
  await Task.collection.updateMany({ _id: { $in: ['task-003', 'task-006'] } }, { $unset: { completedAt: '' } });
  const updatedAt = (await Task.findById('task-003').lean()).updatedAt.toISOString();
  assert.equal(await migrateCompletedAt(), 2);
  const migrated = await Task.findById('task-003').lean();
  assert.equal(migrated.completedAt.toISOString(), updatedAt);
  assert.equal(migrated.updatedAt.toISOString(), updatedAt, 'the backfill does not touch updatedAt');
  assert.equal(await migrateCompletedAt(), 0);
  // Open tasks are left without a completion time.
  assert.equal((await Task.findById('task-001').lean()).completedAt, null);
});

test('the demo seed can add six weeks of completed history', async () => {
  const history = historyTasks();
  assert.equal(history.length, 15);
  assert.ok(history.every((task) => task.status === 'Done' && task.completedAt === task.updatedAt));
  await seedDatabase({ history: true });
  assert.equal(await Task.countDocuments({ _id: /^task-history-/ }), 15);
  await seedDatabase();
  assert.equal(await Task.countDocuments({ _id: /^task-history-/ }), 0, 'the plain seed (tests, CI) has no history');
});

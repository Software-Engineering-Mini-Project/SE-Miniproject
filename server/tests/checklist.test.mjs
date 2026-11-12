// Task checklists: per-item atomic updates, role rules, limits and validation.
// Fixtures: task-002 (Alpha, owned by the Lead) has four items, two done.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Task } from '../models/index.js';
import { CHECKLIST_LIMIT } from '../models/task.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

const app = createApp({ jwtSecret: 'checklist-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: () => {} });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;
const tokens = {};

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  for (const who of ['lead', 'member', 'viewer', 'outsider']) {
    const response = await api().post('/api/auth/login').send({ email: `${who}@example.test`, password: 'Password123!' });
    tokens[who] = response.body.token;
  }
});
after(async () => { await database?.stop(); });

test('tasks carry their checklist; the CSV export does not', async () => {
  const task = await api().get('/api/tasks/task-002').set(auth(tokens.member));
  assert.equal(task.status, 200);
  assert.deepEqual(task.body.checklist.map((item) => [item.id, item.done]), [
    ['check-002-1', true], ['check-002-2', true], ['check-002-3', false], ['check-002-4', false],
  ]);
  const list = await api().get('/api/projects/project-alpha/tasks').set(auth(tokens.member));
  assert.equal(list.body.find((item) => item.id === 'task-002').checklist.length, 4);
  const csv = await api().get('/api/projects/project-alpha/tasks/export.csv').set(auth(tokens.member));
  assert.doesNotMatch(csv.text, /Lay out the three status columns/);
});

test('owners and members add, rename, tick and remove items; viewers and outsiders cannot', async () => {
  const added = await api().post('/api/tasks/task-002/checklist').set(auth(tokens.lead)).send({ text: '  Empty column state  ' });
  assert.equal(added.status, 201, added.text);
  const item = added.body.checklist.at(-1);
  assert.equal(item.text, 'Empty column state');
  assert.equal(item.done, false);
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.equal(added.body.taskId, 'task-002');

  const ticked = await api().patch(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.member)).send({ done: true });
  assert.equal(ticked.status, 200, ticked.text);
  assert.equal(ticked.body.checklist.at(-1).done, true);

  // Members edit the list too.
  const memberAdded = await api().post('/api/tasks/task-002/checklist').set(auth(tokens.member)).send({ text: 'Member step' });
  assert.equal(memberAdded.status, 201);
  const memberItem = memberAdded.body.checklist.at(-1);
  assert.equal((await api().patch(`/api/tasks/task-002/checklist/${memberItem.id}`).set(auth(tokens.member)).send({ text: 'Member step, renamed' })).status, 200);
  assert.equal((await api().delete(`/api/tasks/task-002/checklist/${memberItem.id}`).set(auth(tokens.member))).status, 200);
  // Viewers can't edit it.
  const viewerAdd = await api().post('/api/tasks/task-002/checklist').set(auth(tokens.viewer)).send({ text: 'Nope' });
  assert.equal(viewerAdd.status, 403);
  assert.equal(viewerAdd.body.message, 'Viewers cannot edit tasks.');
  // Viewers can't even tick; outsiders can't see the task.
  const viewer = await api().patch(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.viewer)).send({ done: false });
  assert.equal(viewer.status, 403);
  assert.equal(viewer.body.message, 'Viewers cannot change task status.');
  assert.equal((await api().patch(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.outsider)).send({ done: false })).status, 403);

  const renamed = await api().patch(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.lead)).send({ text: 'Empty state for a column' });
  assert.equal(renamed.body.checklist.at(-1).text, 'Empty state for a column');
  assert.equal(renamed.body.checklist.at(-1).done, true, 'renaming keeps the tick');

  const removed = await api().delete(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.lead));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.checklist.length, 4);
  assert.equal((await api().delete(`/api/tasks/task-002/checklist/${item.id}`).set(auth(tokens.lead))).status, 404);
});

test('concurrent ticks on different items both land', async () => {
  await Promise.all([
    api().patch('/api/tasks/task-002/checklist/check-002-3').set(auth(tokens.member)).send({ done: true }),
    api().patch('/api/tasks/task-002/checklist/check-002-4').set(auth(tokens.lead)).send({ done: true }),
  ]);
  const stored = await Task.findById('task-002').lean();
  assert.ok(stored.checklist.every((item) => item.done));
});

test('input is validated and the item count is capped', async () => {
  const empty = await api().post('/api/tasks/task-002/checklist').set(auth(tokens.lead)).send({ text: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.fields.text, 'Checklist item is required.');
  assert.equal((await api().post('/api/tasks/task-002/checklist').set(auth(tokens.lead)).send({ text: 'x'.repeat(201) })).status, 400);
  assert.equal((await api().post('/api/tasks/task-002/checklist').set(auth(tokens.lead)).send({ text: { $ne: '' } })).status, 400);
  assert.equal((await api().patch('/api/tasks/task-002/checklist/check-002-1').set(auth(tokens.lead)).send({ done: 'yes' })).status, 400);
  assert.equal((await api().patch('/api/tasks/task-002/checklist/check-002-1').set(auth(tokens.lead)).send({})).status, 400);
  assert.equal((await api().patch('/api/tasks/task-002/checklist/missing').set(auth(tokens.lead)).send({ done: true })).status, 404);

  await Task.updateOne({ _id: 'task-001' }, { $set: { checklist: Array.from({ length: CHECKLIST_LIMIT }, (_, i) => ({ id: `c${i}`, text: `Step ${i}`, done: false })) } });
  const full = await api().post('/api/tasks/task-001/checklist').set(auth(tokens.lead)).send({ text: 'One too many' });
  assert.equal(full.status, 400);
  assert.equal(full.body.message, `A task can have at most ${CHECKLIST_LIMIT} checklist items.`);
  assert.equal((await Task.findById('task-001').lean()).checklist.length, CHECKLIST_LIMIT);
});

test('a task without a checklist accepts its first item', async () => {
  const response = await api().post('/api/tasks/task-001/checklist').set(auth(tokens.lead)).send({ text: 'First step' });
  assert.equal(response.status, 201, response.text);
  assert.deepEqual(response.body.checklist.map((item) => item.text), ['First step']);
});

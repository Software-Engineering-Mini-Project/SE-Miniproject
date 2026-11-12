// Task activity history (issue #75): every editing route writes exactly one entry per change,
// naming who did it; the history reads newest first; only people who can open the task see it.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Activity } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

// A clock that moves a second per call, so entries written by consecutive requests sort clearly.
let clock = Date.parse('2026-11-12T09:00:00.000Z');
const now = () => new Date((clock += 1000));
const app = createApp({ jwtSecret: 'activity-tests-use-a-secret-that-is-long-enough-for-hs256', jwtExpiresIn: 7200, logger: () => {}, now });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;
const tokens = {};

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  for (const who of ['admin', 'lead', 'member', 'viewer', 'outsider']) {
    tokens[who] = (await api().post('/api/auth/login').send({ email: `${who}@example.test`, password: 'Password123!' })).body.token;
  }
  tokens.northwind = (await api().post('/api/auth/login').send({ email: 'northwind-admin@example.test', password: 'Password123!' })).body.token;
});
after(async () => { await database?.stop(); });

const history = async (taskId, token = tokens.lead) => (await api().get(`/api/tasks/${taskId}/activity`).set(auth(token))).body;
const actions = async (taskId) => (await history(taskId)).items.map((entry) => entry.action);

test('a fresh database has history: who created each task and who commented', async () => {
  const page = await history('task-002');
  assert.deepEqual(page.items.map((entry) => entry.action), ['comment.add', 'comment.add', 'created'], 'newest first');
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.at(-1).actor, { id: 'user-lead-001', name: page.items.at(-1).actor.name });
  assert.equal(page.items[0].actor.id, 'user-member-001');
});

test('creating, editing and moving a task write one entry per change, by the right person', async () => {
  const created = await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.lead)).send({ title: 'Ship it' });
  const id = created.body.id;
  assert.deepEqual(await actions(id), ['created']);

  // One PATCH that changes four fields writes four entries; one that changes nothing writes none.
  await api().patch(`/api/tasks/${id}`).set(auth(tokens.lead)).send({ priority: 'High', dueDate: '2026-11-20', storyPoints: 3, assigneeIds: ['user-member-001'] });
  assert.deepEqual((await actions(id)).sort(), ['assignees', 'created', 'dueDate', 'priority', 'storyPoints']);
  await api().patch(`/api/tasks/${id}`).set(auth(tokens.lead)).send({ priority: 'High' });
  assert.equal((await actions(id)).length, 5);

  // The assignee moves it: the entry names them, with from and to.
  await api().patch(`/api/tasks/${id}/status`).set(auth(tokens.member)).send({ status: 'In Progress' });
  await api().patch(`/api/tasks/${id}/status`).set(auth(tokens.member)).send({ status: 'In Progress' });
  const page = await history(id);
  assert.equal(page.items[0].action, 'status');
  assert.deepEqual(page.items[0].details, { from: 'To Do', to: 'In Progress' });
  assert.equal(page.items[0].actor.id, 'user-member-001');
  assert.equal(page.items.filter((entry) => entry.action === 'status').length, 1, 'moving to the same column again records nothing');

  await api().patch(`/api/tasks/${id}`).set(auth(tokens.lead)).send({ type: 'Bug', status: 'Done' });
  assert.deepEqual((await actions(id)).slice(0, 2).sort(), ['status', 'type']);
  const assignees = (await history(id)).items.find((entry) => entry.action === 'assignees');
  assert.deepEqual(assignees.details, { added: ['user-member-001'], removed: [] });
});

test('checklist and comment changes are recorded; a deleted comment leaves no text behind', async () => {
  const added = await api().post('/api/tasks/task-001/checklist').set(auth(tokens.lead)).send({ text: 'Write tests' });
  const itemId = added.body.checklist.at(-1).id;
  await api().patch(`/api/tasks/task-001/checklist/${itemId}`).set(auth(tokens.member)).send({ done: true });
  await api().patch(`/api/tasks/task-001/checklist/${itemId}`).set(auth(tokens.lead)).send({ text: 'Write API tests' });
  await api().delete(`/api/tasks/task-001/checklist/${itemId}`).set(auth(tokens.lead));
  const checklist = (await history('task-001')).items.filter((entry) => entry.action.startsWith('checklist.'));
  assert.deepEqual(checklist.map((entry) => [entry.action, entry.details]), [
    ['checklist.remove', { text: 'Write API tests' }],
    ['checklist.rename', { from: 'Write tests', to: 'Write API tests' }],
    ['checklist.check', { text: 'Write tests', done: true }],
    ['checklist.add', { text: 'Write tests' }],
  ]);

  const comment = await api().post('/api/tasks/task-001/comments').set(auth(tokens.viewer)).send({ text: 'Secret plan' });
  let page = await history('task-001');
  assert.equal(page.items[0].action, 'comment.add');
  assert.equal(page.items[0].details.excerpt, 'Secret plan');
  assert.equal(page.items[0].actor.id, 'user-viewer-001');
  await api().delete(`/api/tasks/task-001/comments/${comment.body.id}`).set(auth(tokens.viewer));
  page = await history('task-001');
  assert.equal(page.items[0].action, 'comment.delete');
  assert.equal(page.items[1].details.excerpt, null);
  assert.ok(!JSON.stringify(page).includes('Secret plan'));
});

test('removing a member records the unassignment on each of their tasks, and deletes cascade', async () => {
  await api().delete('/api/projects/project-alpha/members/user-member-001').set(auth(tokens.lead));
  for (const taskId of ['task-001', 'task-002', 'task-004']) {
    const [latest] = (await history(taskId)).items;
    assert.equal(latest.action, 'assignees', taskId);
    assert.deepEqual(latest.details, { added: [], removed: ['user-member-001'] });
    assert.equal(latest.actor.id, 'user-lead-001');
  }
  assert.notEqual((await history('task-005')).items[0].action, 'assignees', 'tasks they were not on are untouched');

  assert.equal((await api().delete('/api/tasks/task-001').set(auth(tokens.lead))).status, 204);
  assert.equal(await Activity.countDocuments({ taskId: 'task-001' }), 0);
  assert.equal((await api().delete('/api/projects/project-beta').set(auth(tokens.admin))).status, 204);
  assert.equal(await Activity.countDocuments({ projectId: 'project-beta' }), 0);
});

test('only people who can open the task see its history; other organisations see nothing', async () => {
  assert.equal((await api().get('/api/tasks/task-001/activity').set(auth(tokens.viewer))).status, 200);
  assert.equal((await api().get('/api/tasks/task-001/activity').set(auth(tokens.outsider))).status, 403);
  assert.equal((await api().get('/api/tasks/task-001/activity').set(auth(tokens.northwind))).status, 404);
  assert.equal((await api().get('/api/tasks/task-001/activity')).status, 401);
  assert.equal((await api().get('/api/tasks/task-001/activity?pageSize=500').set(auth(tokens.lead))).status, 400);
  const paged = (await api().get('/api/tasks/task-002/activity?pageSize=1&page=2').set(auth(tokens.lead))).body;
  assert.deepEqual([paged.items.length, paged.page, paged.pageSize, paged.total], [1, 2, 1, 3]);
});

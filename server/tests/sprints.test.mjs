// Backlog and sprints (issue #76): Owners and Managers run sprints, Members plan tasks into them,
// one active sprint per project, and a completed sprint keeps a record of what it finished.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Sprint, Task } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

let clock = Date.parse('2026-11-12T09:00:00.000Z');
const now = () => new Date((clock += 1000));
const app = createApp({ jwtSecret: 'sprint-tests-use-a-secret-that-is-long-enough-for-hs256', jwtExpiresIn: 7200, logger: () => {}, now });
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

const sprints = async (projectId = 'project-alpha', token = tokens.member) => (await api().get(`/api/projects/${projectId}/sprints`).set(auth(token))).body;
const tasksOf = async (projectId = 'project-alpha') => (await api().get(`/api/projects/${projectId}/tasks`).set(auth(tokens.lead))).body;
const create = (body, token = tokens.lead, projectId = 'project-alpha') => api().post(`/api/projects/${projectId}/sprints`).set(auth(token)).send(body);
const move = (taskId, body, token = tokens.member) => api().post(`/api/tasks/${taskId}/move`).set(auth(token)).send(body);
const history = async (taskId) => (await api().get(`/api/tasks/${taskId}/activity`).set(auth(tokens.lead))).body.items;

test('a fresh database has one completed and one active sprint, and tasks carry sprintId and rank', async () => {
  const list = await sprints();
  assert.deepEqual(list.map((sprint) => [sprint.name, sprint.state]), [['ALPHA Sprint 1', 'completed'], ['ALPHA Sprint 2', 'active']]);
  assert.deepEqual(list[0].report.completed.taskIds, ['task-006', 'task-010']);
  assert.equal(list[0].report.movedTo, 'sprint-alpha-2');
  const tasks = await tasksOf();
  const task = tasks.find((item) => item.id === 'task-004');
  assert.equal(task.sprintId, 'sprint-alpha-2');
  assert.equal(typeof task.rank, 'number');
  assert.equal(tasks.find((item) => item.id === 'task-007').sprintId, null, 'task-007 is in the backlog');
  const seeded = (await history('task-001')).filter((entry) => entry.action === 'sprint');
  assert.deepEqual(seeded.map((entry) => entry.details), [{ from: 'sprint-alpha-1', to: 'sprint-alpha-2' }, { from: null, to: 'sprint-alpha-1' }]);
});

test('Owners and Managers create, edit, start and complete sprints; Members and Viewers cannot', async () => {
  const body = { goal: 'Ship sprints', startDate: '2026-10-28', endDate: '2026-11-10' };
  assert.equal((await create(body, tokens.member)).status, 403);
  assert.equal((await create(body, tokens.viewer)).status, 403);
  assert.equal((await create(body, tokens.outsider)).status, 403);
  assert.equal((await create(body, tokens.northwind)).status, 404);

  const created = await create(body);
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'ALPHA Sprint 3', 'named from the project key and the next number');
  assert.equal(created.body.state, 'planned');
  const id = created.body.id;

  assert.equal((await create({ startDate: '2026-11-10', endDate: '2026-11-01' })).status, 400, 'end before start');
  assert.equal((await create({ name: 'No dates' })).status, 400, 'dates are required');
  assert.equal((await api().patch(`/api/sprints/${id}`).set(auth(tokens.member)).send({ goal: 'x' })).status, 403);
  const renamed = await api().patch(`/api/sprints/${id}`).set(auth(tokens.lead)).send({ name: 'Polish', endDate: '2026-10-27' });
  assert.equal(renamed.status, 400, 'a new end date is checked against the existing start date');
  assert.equal((await api().patch(`/api/sprints/${id}`).set(auth(tokens.lead)).send({ name: 'Polish' })).body.name, 'Polish');

  // One active sprint per project: Sprint 2 is active, so Sprint 3 cannot start yet.
  const blocked = await api().post(`/api/sprints/${id}/start`).set(auth(tokens.lead));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.errorCode, 'ACTIVE_SPRINT_EXISTS');
  assert.match(blocked.body.message, /ALPHA Sprint 2/);
  assert.equal((await api().post('/api/sprints/sprint-alpha-2/complete').set(auth(tokens.member)).send({})).status, 403);
});

test('Members plan tasks into sprints and the backlog, and rank them by placing them between others', async () => {
  const created = (await create({ startDate: '2026-10-28', endDate: '2026-11-10' })).body;
  // Into the planned sprint, keeping its rank; the move is recorded.
  const moved = await move('task-007', { sprintId: created.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.sprintId, created.id);
  assert.deepEqual((await history('task-007'))[0].details, { from: null, to: created.id });
  // Viewers cannot plan.
  assert.equal((await move('task-007', { sprintId: null }, tokens.viewer)).status, 403);
  // Back to the backlog, placed above the epic (task-002), below nothing: the top of the backlog.
  const top = await move('task-007', { sprintId: null, nextId: 'task-002' });
  assert.equal(top.body.sprintId, null);
  const tasks = await tasksOf();
  const rank = (id) => tasks.find((task) => task.id === id).rank;
  assert.ok(rank('task-007') < rank('task-002'));
  // Between two tasks: the midpoint.
  const between = await move('task-002', { previousId: 'task-004', nextId: 'task-005' });
  assert.ok(between.body.rank > rank('task-004') && between.body.rank < rank('task-005'));
  // Reordering alone records no history and does not count as an edit.
  assert.equal((await history('task-002')).filter((entry) => entry.action === 'sprint').length, 0);

  // Not into a completed sprint, another project's sprint, or next to another project's task.
  assert.equal((await move('task-007', { sprintId: 'sprint-alpha-1' })).status, 400);
  assert.equal((await move('task-007', { previousId: 'task-003' })).status, 400);
  assert.equal((await move('task-007', { previousId: 'task-007' })).status, 400);
  // Finished work stays with the completed sprint it was done in.
  assert.equal((await move('task-006', { sprintId: null })).status, 400);
});

test('ranks survive many drops between the same two tasks (the project is renumbered when crowded)', async () => {
  for (let i = 0; i < 60; i += 1) {
    const result = await move(i % 2 ? 'task-007' : 'task-002', { previousId: 'task-004', nextId: i % 2 ? 'task-002' : 'task-007' });
    assert.equal(result.status, 200);
  }
  const ranks = (await tasksOf()).map((task) => task.rank);
  assert.equal(new Set(ranks).size, ranks.length, 'every rank is distinct');
});

test('completing a sprint keeps finished work as its record and moves unfinished work on', async () => {
  const next = (await create({ startDate: '2026-10-28', endDate: '2026-11-10' })).body;
  await api().patch('/api/tasks/task-004/status').set(auth(tokens.member)).send({ status: 'Done' });

  assert.equal((await api().post('/api/sprints/sprint-alpha-2/complete').set(auth(tokens.lead)).send({ moveTo: 'sprint-alpha-1' })).status, 400, 'not into a completed sprint');
  const done = await api().post('/api/sprints/sprint-alpha-2/complete').set(auth(tokens.lead)).send({ moveTo: next.id });
  assert.equal(done.status, 200);
  assert.equal(done.body.state, 'completed');
  assert.deepEqual(done.body.report.completed, { taskIds: ['task-004'], count: 1, points: 5 });
  assert.deepEqual(done.body.report.unfinished.taskIds.sort(), ['task-001', 'task-005']);
  assert.equal(done.body.report.movedTo, next.id);

  const tasks = await tasksOf();
  assert.equal(tasks.find((task) => task.id === 'task-004').sprintId, 'sprint-alpha-2', 'finished work stays');
  assert.equal(tasks.find((task) => task.id === 'task-005').sprintId, next.id, 'unfinished work moved on');
  assert.deepEqual((await history('task-005'))[0].details, { from: 'sprint-alpha-2', to: next.id });

  // A completed sprint is a record: no edits, no restart, no second completion, no delete.
  assert.equal((await api().patch('/api/sprints/sprint-alpha-2').set(auth(tokens.lead)).send({ goal: 'x' })).status, 409);
  assert.equal((await api().post('/api/sprints/sprint-alpha-2/start').set(auth(tokens.lead))).status, 409);
  assert.equal((await api().post('/api/sprints/sprint-alpha-2/complete').set(auth(tokens.lead)).send({})).status, 409);
  assert.equal((await api().delete('/api/sprints/sprint-alpha-2').set(auth(tokens.lead))).status, 409);

  // Now the next sprint can start; it commits to what it holds.
  const started = await api().post(`/api/sprints/${next.id}/start`).set(auth(tokens.lead));
  assert.equal(started.status, 200);
  assert.deepEqual(started.body.committed.taskIds.sort(), ['task-001', 'task-005']);
  assert.equal(started.body.committed.points, 5);
  assert.ok(started.body.startedAt);

  // Reopening work finished in a completed sprint sends it back to the backlog.
  const reopened = await api().patch('/api/tasks/task-004/status').set(auth(tokens.member)).send({ status: 'In Progress' });
  assert.equal(reopened.body.sprintId, null);
  assert.equal((await history('task-004'))[0].action, 'sprint');
});

test('the database itself allows only one active sprint per project', async () => {
  await Sprint.create({ projectId: 'project-beta', number: 1, name: 'B1', startDate: '2026-10-01', endDate: '2026-10-14', state: 'active' });
  await assert.rejects(Sprint.create({ projectId: 'project-beta', number: 2, name: 'B2', startDate: '2026-10-15', endDate: '2026-10-28', state: 'active' }), /duplicate key/);
});

test('deleting a planned sprint returns its tasks to the backlog; deleting a project removes its sprints', async () => {
  const planned = (await create({ startDate: '2026-10-28', endDate: '2026-11-10' })).body;
  await move('task-007', { sprintId: planned.id });
  assert.equal((await api().delete(`/api/sprints/${planned.id}`).set(auth(tokens.member))).status, 403);
  assert.equal((await api().delete(`/api/sprints/${planned.id}`).set(auth(tokens.lead))).status, 204);
  assert.equal((await Task.findById('task-007').lean()).sprintId, null);
  assert.equal((await api().delete('/api/sprints/sprint-alpha-2').set(auth(tokens.lead))).status, 409, 'an active sprint is completed, not deleted');

  assert.equal((await api().delete('/api/projects/project-alpha').set(auth(tokens.admin))).status, 204);
  assert.equal(await Sprint.countDocuments({ projectId: 'project-alpha' }), 0);
});

test('new tasks join the bottom of the backlog; tasks without a rank get one first', async () => {
  await Task.updateMany({ projectId: 'project-beta' }, { $unset: { rank: 1 } });
  const created = await api().post('/api/projects/project-beta/tasks').set(auth(tokens.lead)).send({ title: 'Last in line' });
  assert.equal(created.status, 201);
  assert.equal(created.body.sprintId, null);
  const tasks = await tasksOf('project-beta');
  assert.ok(tasks.every((task) => typeof task.rank === 'number'));
  assert.equal(Math.max(...tasks.map((task) => task.rank)), created.body.rank);
});

test('the sprint report and burndown follow the activity history (issue #77)', async () => {
  const report = async (sprintId, token = tokens.viewer) => api().get(`/api/sprints/${sprintId}/report`).set(auth(token));
  const done = (await report('sprint-alpha-1')).body;
  assert.equal(done.unit, 'points');
  assert.deepEqual([done.committed.points, done.completed.taskIds, done.carriedOver.count, done.carriedOver.movedTo], [4, ['task-006', 'task-010'], 1, 'sprint-alpha-2']);
  assert.deepEqual(done.days.map((day) => day.remaining), [4, 4, 4, 4, 4, 4, 4, 2, 2, 2]);

  // Adding work to the running sprint shows up as added; finishing work burns it down.
  await move('task-007', { sprintId: 'sprint-alpha-2' });
  await api().patch('/api/tasks/task-005/status').set(auth(tokens.member)).send({ status: 'Done' });
  const running = (await report('sprint-alpha-2')).body;
  assert.deepEqual(running.added.taskIds, ['task-007']);
  assert.deepEqual(running.completed.taskIds, ['task-005']);
  assert.equal(running.days.length, 14);
  assert.equal(running.days[0].remaining, 10);

  assert.equal((await report('sprint-alpha-2', tokens.outsider)).status, 403);
  assert.equal((await report('sprint-alpha-2', tokens.northwind)).status, 404);
  assert.equal((await api().get('/api/sprints/sprint-alpha-2/report')).status, 401);
});

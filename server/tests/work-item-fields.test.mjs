// Work-item types, story points, labels and epics (issue #74). Fixtures: in Alpha, task-002
// (ALPHA-4) is an Epic holding task-005 (a 3-point Story labelled frontend and accessibility);
// task-007 is a Bug; task-010 has no estimate and no labels.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

const app = createApp({ jwtSecret: 'work-item-field-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: () => {} });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;
const tokens = {};

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  for (const who of ['lead', 'member', 'viewer']) {
    tokens[who] = (await api().post('/api/auth/login').send({ email: `${who}@example.test`, password: 'Password123!' })).body.token;
  }
});
after(async () => { await database?.stop(); });

const alphaTasks = async (query = '') => api().get(`/api/projects/project-alpha/tasks${query}`).set(auth(tokens.lead));
const create = (body, token = tokens.lead, projectId = 'project-alpha') => api().post(`/api/projects/${projectId}/tasks`).set(auth(token)).send(body);
const patch = (taskId, body, token = tokens.lead) => api().patch(`/api/tasks/${taskId}`).set(auth(token)).send(body);

test('tasks carry type, story points, labels and epic, with defaults for plain tasks', async () => {
  const response = await alphaTasks();
  assert.equal(response.status, 200);
  const byId = new Map(response.body.map((task) => [task.id, task]));
  assert.equal(byId.get('task-002').type, 'Epic');
  assert.deepEqual(
    (({ type, storyPoints, labels, epicId }) => ({ type, storyPoints, labels, epicId }))(byId.get('task-005')),
    { type: 'Story', storyPoints: 3, labels: ['frontend', 'accessibility'], epicId: 'task-002' },
  );
  assert.deepEqual([byId.get('task-010').storyPoints, byId.get('task-010').labels, byId.get('task-010').epicId], [null, [], null]);

  const plain = await create({ title: 'No extras' });
  assert.equal(plain.status, 201);
  assert.deepEqual([plain.body.type, plain.body.storyPoints, plain.body.labels, plain.body.epicId], ['Task', null, [], null]);

  const full = await create({ title: 'Fix login', type: 'Bug', storyPoints: 5, labels: [' Auth ', '#auth', 'Front End'], epicId: 'task-002' });
  assert.equal(full.status, 201);
  assert.deepEqual([full.body.type, full.body.storyPoints, full.body.labels, full.body.epicId], ['Bug', 5, ['auth', 'front-end'], 'task-002']);

  const mine = await api().get('/api/dashboard').set(auth(tokens.lead));
  assert.ok(mine.body.myTasks.every((task) => typeof task.type === 'string' && Array.isArray(task.labels)));
});

test('only the allowed values are accepted', async () => {
  for (const [body, field] of [
    [{ storyPoints: 4 }, 'storyPoints'],
    [{ storyPoints: '3' }, 'storyPoints'],
    [{ type: 'Feature' }, 'type'],
    [{ type: { $ne: null } }, 'type'],
    [{ labels: 'frontend' }, 'labels'],
    [{ labels: [{ $gt: '' }] }, 'labels'],
    [{ labels: ['x'.repeat(31)] }, 'labels'],
    [{ labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }, 'labels'],
  ]) {
    const created = await create({ title: 'Bad', ...body });
    assert.equal(created.status, 400, JSON.stringify(body));
    assert.ok(created.body.fields?.[field], `${JSON.stringify(body)} -> fields.${field}`);
    const updated = await patch('task-001', body);
    assert.equal(updated.status, 400, `PATCH ${JSON.stringify(body)}`);
  }
  const cleared = await patch('task-005', { storyPoints: null, labels: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual([cleared.body.storyPoints, cleared.body.labels], [null, []]);
});

test('epic rules: an Epic in the same project, never nested, and an epic with items keeps its type', async () => {
  // Not an epic, or an epic of another project, is refused.
  assert.equal((await create({ title: 'Under a task', epicId: 'task-001' })).status, 400);
  const betaEpic = await create({ title: 'Beta epic', type: 'Epic' }, tokens.lead, 'project-beta');
  assert.equal(betaEpic.status, 201);
  const crossProject = await create({ title: 'Cross', epicId: betaEpic.body.id });
  assert.equal(crossProject.status, 400);
  assert.match(crossProject.body.fields.epicId, /from this project/);
  assert.equal((await create({ title: 'Ghost', epicId: 'task-999' })).status, 400);

  // An epic inside an epic, either way round.
  const nested = await create({ title: 'Nested', type: 'Epic', epicId: 'task-002' });
  assert.equal(nested.status, 400);
  assert.match(nested.body.fields.epicId, /cannot belong to another epic/);
  const promoted = await patch('task-005', { type: 'Epic' });
  assert.equal(promoted.status, 400, 'task-005 sits in an epic, so it cannot become one');
  assert.equal((await patch('task-002', { epicId: 'task-002' })).status, 400);

  // An epic with items keeps its type until they move out; then it can change.
  const demoted = await patch('task-002', { type: 'Task' });
  assert.equal(demoted.status, 400);
  assert.match(demoted.body.fields.type, /Move the 1 item out of this epic first/);
  assert.equal((await patch('task-005', { epicId: null })).status, 200);
  assert.equal((await patch('task-002', { type: 'Task' })).status, 200);

  // Moving a story into an epic and back out.
  const epic = await create({ title: 'Launch', type: 'Epic' });
  const moved = await patch('task-004', { epicId: epic.body.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.epicId, epic.body.id);
});

test('deleting an epic keeps its items, outside any epic', async () => {
  assert.equal((await api().delete('/api/tasks/task-002').set(auth(tokens.lead))).status, 204);
  const child = await api().get('/api/tasks/task-005').set(auth(tokens.lead));
  assert.equal(child.status, 200);
  assert.equal(child.body.epicId, null);
});

test('filters by type, label and epic, on the project and across projects', async () => {
  const ids = (response) => response.body.map((task) => task.id).sort();
  assert.deepEqual(ids(await alphaTasks('?type=Bug')), ['task-007']);
  assert.deepEqual(ids(await alphaTasks('?label=frontend')), ['task-002', 'task-004', 'task-005']);
  assert.deepEqual(ids(await alphaTasks('?label=%23FRONTEND')), ['task-002', 'task-004', 'task-005'], 'labels match whatever the case');
  assert.deepEqual(ids(await alphaTasks('?epicId=task-002')), ['task-005']);
  assert.deepEqual(ids(await alphaTasks('?type=Story&label=auth')), ['task-004']);
  assert.equal((await alphaTasks('?type=Feature')).status, 400);
  assert.equal((await alphaTasks('?label=-bad')).status, 400);
  const everywhere = await api().get('/api/tasks?label=accessibility').set(auth(tokens.lead));
  assert.deepEqual(ids(everywhere), ['task-005', 'task-009']);
});

test('editing these fields follows task-editing permissions', async () => {
  const viewer = await patch('task-005', { storyPoints: 8 }, tokens.viewer);
  assert.equal(viewer.status, 403);
  const member = await patch('task-005', { storyPoints: 8, labels: ['frontend'] }, tokens.member);
  assert.equal(member.status, 200);
  assert.equal(member.body.storyPoints, 8);
  assert.equal((await create({ title: 'Viewer bug', type: 'Bug' }, tokens.viewer)).status, 403);
});

test('the CSV export has type, points, labels and the epic key', async () => {
  const csv = await api().get('/api/projects/project-alpha/tasks/export.csv').set(auth(tokens.lead));
  assert.equal(csv.status, 200);
  const [header, ...rows] = csv.text.split('\r\n');
  assert.equal(header, 'id,key,type,title,status,priority,storyPoints,labels,epic,dueDate,assignees,createdAt,updatedAt');
  const story = rows.find((row) => row.startsWith('task-005,'));
  assert.match(story, /^task-005,ALPHA-6,Story,Keyboard support for moving board cards,To Do,Medium,3,frontend; accessibility,ALPHA-4,/);
  assert.match(rows.find((row) => row.startsWith('task-010,')), /,Done,High,,,,/);
});

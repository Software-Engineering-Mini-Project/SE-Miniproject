// Work-item keys (issue #73): projects have a key, tasks a number in their project, and a task
// reads as ALPHA-12 everywhere. Fixture keys: Alpha Project = ALPHA (tasks ALPHA-1..7, oldest
// first), Beta Project = BETA (BETA-1..3), Northwind Roadmap = NORTH (another organisation).
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Project, Task } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { migrateWorkItemKeys } from '../utils/migrations.js';
import { seedDatabase } from '../utils/seed-database.js';
import { formatTaskKey, numberTasks, parseTaskKey, projectKeyError, suggestProjectKey } from '../../src/lib/work-items.js';

const logRecords = [];
const app = createApp({ jwtSecret: 'work-item-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;
const tokens = {};

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  logRecords.length = 0;
  for (const who of ['admin', 'lead', 'member', 'viewer', 'outsider']) {
    tokens[who] = (await api().post('/api/auth/login').send({ email: `${who}@example.test`, password: 'Password123!' })).body.token;
  }
  tokens.northwind = (await api().post('/api/auth/login').send({ email: 'northwind-admin@example.test', password: 'Password123!' })).body.token;
});
after(async () => { await database?.stop(); });

test('key helpers: suggestions, validation, parsing and numbering', () => {
  assert.equal(suggestProjectKey('Alpha Project'), 'ALPHA');
  assert.equal(suggestProjectKey('Alpha Project', new Set(['ALPHA'])), 'AP');
  assert.equal(suggestProjectKey('Alpha Project', new Set(['ALPHA', 'AP', 'ALPHP'])), 'ALPHAA', 'then letters are added');
  assert.equal(suggestProjectKey('QA'), 'QA');
  assert.equal(suggestProjectKey('Café déjà vu'), 'CAFE');
  assert.equal(suggestProjectKey('2026 🚀'), 'PROJ');
  assert.match(suggestProjectKey('X'), /^[A-Z]{2,10}$/);
  assert.equal(projectKeyError('ALPHA'), null);
  for (const bad of ['', 'A', 'ALPHA1', 'AL-PHA', 'abcdefghijk', 'ABCDEFGHIJK']) assert.ok(projectKeyError(bad), bad);
  assert.deepEqual(parseTaskKey(' alpha-12 '), { projectKey: 'ALPHA', number: 12 });
  for (const bad of ['ALPHA', 'ALPHA-0', 'A-1', 'ALPHA-1x', '12', null]) assert.equal(parseTaskKey(bad), null, String(bad));
  assert.equal(formatTaskKey('ALPHA', 3), 'ALPHA-3');
  assert.equal(formatTaskKey(null, 3), null);
  const { tasks, counters } = numberTasks([
    { id: 'b', projectId: 'p', createdAt: '2026-01-02' },
    { id: 'a', projectId: 'p', createdAt: '2026-01-01' },
    { id: 'c', projectId: 'p', number: 5, createdAt: '2026-01-03' },
    { id: 'd', projectId: 'q', createdAt: '2026-01-01' },
  ]);
  assert.deepEqual(tasks.map((task) => [task.id, task.number]), [['b', 7], ['a', 6], ['c', 5], ['d', 1]]);
  assert.deepEqual(counters, { p: 7, q: 1 });
});

test('tasks carry their key in every response: list, one, search, dashboard and export', async () => {
  const list = await api().get('/api/projects/project-alpha/tasks').set(auth(tokens.lead));
  const byId = new Map(list.body.map((task) => [task.id, task]));
  assert.equal(byId.get('task-001').key, 'ALPHA-1');
  assert.equal(byId.get('task-007').key, 'ALPHA-7');
  assert.equal(byId.get('task-001').number, 1);
  assert.equal((await api().get('/api/tasks/task-003').set(auth(tokens.admin))).body.key, 'BETA-1');
  const all = await api().get('/api/tasks').set(auth(tokens.admin));
  assert.ok(all.body.every((task) => /^(ALPHA|BETA)-\d+$/.test(task.key)), 'every task in /tasks has a key');
  const dashboard = await api().get('/api/dashboard').set(auth(tokens.member));
  assert.ok(dashboard.body.myTasks.length > 0 && dashboard.body.myTasks.every((task) => /^ALPHA-\d+$/.test(task.key)));
  const csv = await api().get('/api/projects/project-beta/tasks/export.csv').set(auth(tokens.admin));
  assert.match(csv.text.split('\r\n')[0], /^id,key,type,title,/);
  assert.match(csv.text, /task-003,BETA-1,/);
  const project = await api().get('/api/projects/project-alpha').set(auth(tokens.lead));
  assert.equal(project.body.key, 'ALPHA');
  assert.deepEqual(project.body.previousKeys, []);
  assert.equal(project.body.taskCounter, undefined, 'the counter is internal');
});

test('new tasks take the next number, and simultaneous creates never share one', async () => {
  const one = await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.member)).send({ title: 'Next one' });
  assert.equal(one.status, 201, one.text);
  assert.equal(one.body.key, 'ALPHA-8');
  const burst = await Promise.all(Array.from({ length: 12 }, (_, index) => api().post('/api/projects/project-alpha/tasks').set(auth(tokens.member)).send({ title: `Burst ${index}` })));
  assert.ok(burst.every((response) => response.status === 201));
  const numbers = burst.map((response) => response.body.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 12 }, (_, index) => index + 9), 'ALPHA-9..20, each once');
  assert.equal((await Project.findById('project-alpha').lean()).taskCounter, 20);
  // Numbers are per project: Beta continues from its own counter.
  assert.equal((await api().post('/api/projects/project-beta/tasks').set(auth(tokens.admin)).send({ title: 'Beta next' })).body.key, 'BETA-4');
  // Deleting a task never frees its number for reuse.
  await api().delete(`/api/tasks/${one.body.id}`).set(auth(tokens.lead));
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.member)).send({ title: 'After delete' })).body.key, 'ALPHA-21');
});

test('assignment notifications name the task by its key', async () => {
  const created = await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.lead)).send({ title: 'Ship it', assigneeIds: ['user-member-001'] });
  const inbox = await api().get('/api/notifications').set(auth(tokens.member));
  assert.ok(inbox.body.items.some((item) => item.message === `You were assigned to ${created.body.key} "Ship it".`));
});

test('a new project gets a free key suggested from its name, or the one asked for', async () => {
  const suggestion = await api().get('/api/projects/key-suggestion?name=Alpha%20Launch').set(auth(tokens.member));
  assert.deepEqual(suggestion.body, { key: 'AL' }, 'ALPHA is taken in Acme, so the initials');
  const suggested = await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Alpha Launch' });
  assert.equal(suggested.status, 201, suggested.text);
  assert.equal(suggested.body.key, 'AL');
  const chosen = await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Mobile', key: ' mob ' });
  assert.equal(chosen.body.key, 'MOB');
  const taken = await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Copy', key: 'BETA' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.errorCode, 'KEY_TAKEN');
  assert.ok(taken.body.fields.key);
  const invalid = await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Bad', key: 'B4D' });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields.key);
  // Keys are unique per organisation: Northwind may use ALPHA.
  const elsewhere = await api().post('/api/projects').set(auth(tokens.northwind)).send({ name: 'Alpha elsewhere', key: 'ALPHA' });
  assert.equal(elsewhere.status, 201, elsewhere.text);
  assert.equal(elsewhere.body.key, 'ALPHA');
  // Two projects with the same name created at once still get different keys.
  const pair = await Promise.all([1, 2].map(() => api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Gamma' })));
  assert.ok(pair.every((response) => response.status === 201));
  assert.notEqual(pair[0].body.key, pair[1].body.key);
});

test('only the owner (or an admin) changes the key; old keys keep finding their tasks', async () => {
  // Lead owns Alpha; member is a Member; lead is a Manager of Beta (owned by admin).
  assert.equal((await api().patch('/api/projects/project-alpha').set(auth(tokens.member)).send({ key: 'CORE' })).status, 403);
  const asManager = await api().patch('/api/projects/project-beta').set(auth(tokens.lead)).send({ key: 'QUAL' });
  assert.equal(asManager.status, 403);
  assert.match(asManager.body.message, /owner or an admin/);
  // A manager can still edit the rest of the project.
  assert.equal((await api().patch('/api/projects/project-beta').set(auth(tokens.lead)).send({ name: 'Beta Project', key: 'BETA' })).status, 200, 'sending the unchanged key is fine');

  const renamed = await api().patch('/api/projects/project-alpha').set(auth(tokens.lead)).send({ key: 'core' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.key, 'CORE');
  assert.deepEqual(renamed.body.previousKeys, ['ALPHA']);
  assert.ok(logRecords.some((record) => record.audit && record.change?.field === 'projectKey' && record.change.from === 'ALPHA' && record.change.to === 'CORE'));
  assert.equal((await api().get('/api/tasks/task-001').set(auth(tokens.lead))).body.key, 'CORE-1');
  // The old key still opens the task and still finds it in search.
  const old = await api().get('/api/tasks/by-key/ALPHA-1').set(auth(tokens.member));
  assert.equal(old.status, 200, old.text);
  assert.equal(old.body.id, 'task-001');
  assert.equal(old.body.key, 'CORE-1');
  assert.deepEqual((await api().get('/api/projects/project-alpha/tasks?q=alpha-4').set(auth(tokens.lead))).body.map((task) => task.id), ['task-002']);
  // Nobody else can take a key a project used before; going back to it is fine.
  assert.equal((await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Thief', key: 'ALPHA' })).status, 409);
  assert.equal((await api().patch('/api/projects/project-beta').set(auth(tokens.admin)).send({ key: 'ALPHA' })).status, 409);
  const back = await api().patch('/api/projects/project-alpha').set(auth(tokens.admin)).send({ key: 'ALPHA' });
  assert.equal(back.body.key, 'ALPHA');
  assert.deepEqual(back.body.previousKeys, ['CORE']);
});

test('search by key works in a project and across projects, in any case', async () => {
  assert.deepEqual((await api().get('/api/projects/project-alpha/tasks?q=ALPHA-5').set(auth(tokens.lead))).body.map((task) => task.id), ['task-004']);
  assert.deepEqual((await api().get('/api/tasks?q=beta-2').set(auth(tokens.admin))).body.map((task) => task.id), ['task-008']);
  // Key search combines with the other filters, and text search still works.
  assert.deepEqual((await api().get('/api/tasks?q=beta-2&status=To%20Do').set(auth(tokens.admin))).body.map((task) => task.status), (await Task.find({ _id: 'task-008', status: 'To Do' }).lean()).map((task) => task.status));
  assert.ok((await api().get('/api/tasks?q=release').set(auth(tokens.admin))).body.length > 0);
  // The member is not in Beta, so BETA-2 finds nothing for them.
  assert.deepEqual((await api().get('/api/tasks?q=BETA-2').set(auth(tokens.member))).body, []);
});

test('lookup by key respects membership and never crosses organisations', async () => {
  assert.equal((await api().get('/api/tasks/by-key/beta-1').set(auth(tokens.admin))).body.id, 'task-003');
  assert.equal((await api().get('/api/tasks/by-key/BETA-1').set(auth(tokens.member))).status, 403, 'a private project the member is not in');
  assert.equal((await api().get('/api/tasks/by-key/ALPHA-99').set(auth(tokens.lead))).status, 404);
  assert.equal((await api().get('/api/tasks/by-key/not-a-key').set(auth(tokens.lead))).status, 404);
  assert.equal((await api().get('/api/tasks/by-key/ALPHA-1')).status, 401);
  // Northwind's admin sees no Acme keys, and Acme sees none of Northwind's.
  assert.equal((await api().get('/api/tasks/by-key/ALPHA-1').set(auth(tokens.northwind))).status, 404);
  const northwindTask = await api().post('/api/projects/project-northwind/tasks').set(auth(tokens.northwind)).send({ title: 'Roadmap' });
  assert.equal(northwindTask.body.key, 'NORTH-1');
  assert.equal((await api().get('/api/tasks/by-key/NORTH-1').set(auth(tokens.admin))).status, 404);
  // Its open project's directory entry shows the key, but its tasks stay out of reach.
  assert.equal((await api().get('/api/tasks/by-key/NORTH-1').set(auth(tokens.outsider))).status, 404);
});

test('the migration gives old projects keys and old tasks numbers, once, oldest first', async () => {
  await Project.collection.updateMany({}, { $unset: { key: '', taskCounter: '', previousKeys: '' } });
  await Task.collection.updateMany({}, { $unset: { number: '' } });
  const updated = await migrateWorkItemKeys();
  assert.equal(updated, 3 + 10, 'three projects and ten tasks');
  assert.equal(await migrateWorkItemKeys(), 0, 'running it again changes nothing');
  const projects = new Map((await Project.find().lean()).map((project) => [String(project._id), project]));
  assert.equal(projects.get('project-alpha').key, 'ALPHA');
  assert.equal(projects.get('project-beta').key, 'BETA');
  assert.equal(projects.get('project-northwind').key, 'NORTH');
  assert.equal(projects.get('project-alpha').taskCounter, 7);
  const task = await Task.findById('task-010').lean();
  assert.equal(task.number, 3, 'third-oldest Alpha task');
  // New tasks continue after the migrated numbers.
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.member)).send({ title: 'After migration' })).body.key, 'ALPHA-8');
});

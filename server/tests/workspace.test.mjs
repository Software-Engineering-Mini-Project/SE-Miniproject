// Open workspace: who may create projects (an Admin setting), Open vs Private projects,
// the project directory and joining. Fixtures: Alpha and Beta are private.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Project } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';

const logRecords = [];
const app = createApp({ jwtSecret: 'workspace-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
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
});
after(async () => { await database?.stop(); });

test('everyone can create projects by default; an Admin can limit it to leads', async () => {
  assert.deepEqual((await api().get('/api/settings').set(auth(tokens.member))).body, { projectCreation: 'everyone' });
  const own = await api().post('/api/projects').set(auth(tokens.outsider)).send({ name: 'My first project' });
  assert.equal(own.status, 201, own.text);
  assert.equal(own.body.ownerId, 'user-outsider-001');
  assert.equal(own.body.members[0].projectRole, 'Owner');

  // Only Admins change settings, with validation; the change is audited.
  assert.equal((await api().patch('/api/settings').set(auth(tokens.lead)).send({ projectCreation: 'leads' })).status, 403);
  assert.equal((await api().patch('/api/settings').set(auth(tokens.admin)).send({ projectCreation: 'nobody' })).status, 400);
  assert.equal((await api().patch('/api/settings').set(auth(tokens.admin)).send({})).status, 400);
  const limited = await api().patch('/api/settings').set(auth(tokens.admin)).send({ projectCreation: 'leads' });
  assert.deepEqual(limited.body, { projectCreation: 'leads' });
  const audit = logRecords.find((record) => record.route === '/api/settings' && record.change);
  assert.deepEqual(audit?.change, { field: 'projectCreation', from: 'everyone', to: 'leads' });

  assert.equal((await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Not now' })).status, 403);
  assert.equal((await api().post('/api/projects').set(auth(tokens.lead)).send({ name: 'Lead project' })).status, 201);
  assert.equal((await api().post('/api/projects').set(auth(tokens.admin)).send({ name: 'Admin project' })).status, 201);
  assert.deepEqual((await api().get('/api/settings').set(auth(tokens.member))).body, { projectCreation: 'leads' });
});

test('open projects are listed in the directory and can be joined; private ones stay hidden', async () => {
  const created = await api().post('/api/projects').set(auth(tokens.lead)).send({ name: 'Design system', description: 'Shared components', visibility: 'open' });
  assert.equal(created.status, 201);
  assert.equal(created.body.visibility, 'open');
  assert.equal((await api().post('/api/projects').set(auth(tokens.lead)).send({ name: 'Bad', visibility: 'public' })).status, 400);

  const directory = await api().get('/api/projects/directory').set(auth(tokens.outsider));
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.body, [{ id: created.body.id, name: 'Design system', key: 'DESIG', description: 'Shared components', ownerName: 'Synthetic Lead', memberCount: 1 }]);
  assert.deepEqual((await api().get('/api/projects/directory').set(auth(tokens.lead))).body, [], 'projects you are in are not listed');
  assert.equal((await api().get('/api/projects/directory?q=design').set(auth(tokens.outsider))).body.length, 1);
  assert.equal((await api().get('/api/projects/directory?q=alpha').set(auth(tokens.outsider))).body.length, 0, 'private projects never appear');
  assert.equal((await api().get('/api/projects/directory?q=.*').set(auth(tokens.outsider))).body.length, 0, 'the search is literal text');

  // Before joining, the project says it can be joined instead of a bare 403.
  const peek = await api().get(`/api/projects/${created.body.id}`).set(auth(tokens.outsider));
  assert.equal(peek.status, 403);
  assert.equal(peek.body.errorCode, 'JOIN_REQUIRED');
  const privatePeek = await api().get('/api/projects/project-alpha').set(auth(tokens.outsider));
  assert.equal(privatePeek.body.errorCode, 'FORBIDDEN');

  const joined = await api().post(`/api/projects/${created.body.id}/join`).set(auth(tokens.outsider));
  assert.equal(joined.status, 201, joined.text);
  assert.equal(joined.body.members.find((member) => member.id === 'user-outsider-001').projectRole, 'Member');
  assert.equal(logRecords.find((record) => record.route === '/api/projects/:projectId/join' && record.change)?.change.to, 'Member');
  assert.equal((await api().post(`/api/projects/${created.body.id}/join`).set(auth(tokens.outsider))).status, 200, 'joining twice is harmless');
  assert.equal((await Project.findById(created.body.id).lean()).memberIds.length, 2);
  assert.equal((await api().get(`/api/projects/${created.body.id}`).set(auth(tokens.outsider))).status, 200);
  // As a Member they can create tasks right away.
  assert.equal((await api().post(`/api/projects/${created.body.id}/tasks`).set(auth(tokens.outsider)).send({ title: 'First contribution' })).status, 201);

  const privateJoin = await api().post('/api/projects/project-alpha/join').set(auth(tokens.outsider));
  assert.equal(privateJoin.status, 403);
  assert.equal(privateJoin.body.message, 'This project is private. Ask its owner or a manager to add you.');
  assert.equal((await api().post('/api/projects/nope/join').set(auth(tokens.outsider))).status, 404);
  assert.equal((await api().post('/api/projects/$bad/join').set(auth(tokens.outsider))).status, 400);
  assert.equal((await api().post('/api/projects/project-alpha/join').set(auth(tokens.member))).status, 200, 'members of a private project can "join" it idempotently');
});

test('owners and managers switch visibility; making a project private keeps its members', async () => {
  const toOpen = await api().patch('/api/projects/project-alpha').set(auth(tokens.lead)).send({ visibility: 'open' });
  assert.equal(toOpen.status, 200);
  assert.equal(toOpen.body.visibility, 'open');
  assert.equal((await api().patch('/api/projects/project-alpha').set(auth(tokens.member)).send({ visibility: 'private' })).status, 403);
  assert.equal((await api().patch('/api/projects/project-alpha').set(auth(tokens.lead)).send({ visibility: 'secret' })).status, 400);
  await api().post('/api/projects/project-alpha/join').set(auth(tokens.outsider));
  const toPrivate = await api().patch('/api/projects/project-alpha').set(auth(tokens.lead)).send({ visibility: 'private' });
  assert.equal(toPrivate.body.visibility, 'private');
  assert.ok(toPrivate.body.memberIds.includes('user-outsider-001'));
  assert.equal((await api().get('/api/projects/directory').set(auth(tokens.admin))).body.length, 0);
});

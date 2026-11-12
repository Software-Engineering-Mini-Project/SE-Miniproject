// Organisations: every account and project belongs to exactly one, nothing crosses between them,
// people join with an invite code or start their own, and the organisation page's routes.
// Fixtures: "Acme Labs" (org-acme, the demo organisation) and "Northwind Studio" (org-northwind,
// one admin and one open project) exist only to prove isolation.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../app.js';
import { Organisation, Project, User } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { DEFAULT_ORGANISATION_ID, runMigrations } from '../utils/migrations.js';
import { seedDatabase } from '../utils/seed-database.js';

const logRecords = [];
const app = createApp({ jwtSecret: 'organisation-tests-use-a-secret-long-enough-for-hs256', jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);
const PASSWORD = 'Password123!';

let database;
const tokens = {};

async function signIn(email) {
  const response = await api().post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(response.status, 200, response.text);
  return response.body.token;
}

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => {
  await seedDatabase();
  logRecords.length = 0;
  for (const who of ['admin', 'lead', 'member', 'viewer', 'outsider']) tokens[who] = await signIn(`${who}@example.test`);
  tokens.northwind = await signIn('northwind-admin@example.test');
});
after(async () => { await database?.stop(); });

test('registering starts a new organisation (as its Admin) or joins one with an invite code (as a Member)', async () => {
  const created = await api().post('/api/auth/register').send({ name: 'Founder', email: 'founder@example.test', password: PASSWORD, organisationName: '  Globex  ' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.role, 'Admin');
  assert.equal(created.body.organisation.name, 'Globex');
  const founder = await User.findById(created.body.userId).lean();
  assert.equal(founder.organisationId, created.body.organisation.id);
  assert.equal((await Organisation.findById(founder.organisationId).lean()).createdById, founder._id);

  const session = await api().post('/api/auth/login').send({ email: 'founder@example.test', password: PASSWORD });
  assert.deepEqual(session.body.user.organisation, created.body.organisation);
  assert.equal(session.body.user.role, 'Admin');
  const me = await api().get('/api/auth/me').set(auth(session.body.token));
  assert.deepEqual(me.body.organisation, created.body.organisation);

  // The new organisation is empty and separate: it sees none of Acme's projects.
  assert.deepEqual((await api().get('/api/projects').set(auth(session.body.token))).body, []);

  // The invite code is case- and punctuation-insensitive; whoever joins is a Member, whatever role they ask for.
  const joined = await api().post('/api/auth/register').send({ name: 'Joiner', email: 'joiner@example.test', password: PASSWORD, joinCode: 'acme labs', role: 'Admin' });
  assert.equal(joined.status, 201, joined.text);
  assert.equal(joined.body.role, 'Member');
  assert.deepEqual(joined.body.organisation, { id: 'org-acme', name: 'Acme Labs' });
});

test('registration needs exactly one of an invite code and an organisation name, and a code that exists', async () => {
  const base = { name: 'Someone', email: 'someone@example.test', password: PASSWORD };
  const neither = await api().post('/api/auth/register').send(base);
  assert.equal(neither.status, 400);
  assert.ok(neither.body.fields.joinCode);
  const both = await api().post('/api/auth/register').send({ ...base, joinCode: 'ACMELABS', organisationName: 'Both' });
  assert.equal(both.status, 400);
  const unknown = await api().post('/api/auth/register').send({ ...base, joinCode: 'NOSUCHCODE' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.fields.joinCode, /not recognised/);
  assert.equal((await api().post('/api/auth/register').send({ ...base, joinCode: '12' })).status, 400);
  assert.equal((await api().post('/api/auth/register').send({ ...base, joinCode: 12345678 })).status, 400);
  assert.equal((await api().post('/api/auth/register').send({ ...base, organisationName: 'x'.repeat(81) })).status, 400);
  assert.equal(await User.exists({ emailNormalized: 'someone@example.test' }), null);
  assert.equal(await Organisation.countDocuments(), 2, 'a failed registration leaves no organisation behind');
});

test('a duplicate email creates no organisation', async () => {
  const response = await api().post('/api/auth/register').send({ name: 'Dup', email: 'MEMBER@example.test', password: PASSWORD, organisationName: 'Ghost Co' });
  assert.equal(response.status, 409);
  assert.equal(await Organisation.countDocuments({ name: 'Ghost Co' }), 0);
});

test('nothing crosses organisations: projects, tasks, people and the directory stay separate', async () => {
  const northwindProject = 'project-northwind';

  // Northwind's admin sees only Northwind's project, and Acme's are as good as absent (404, not 403).
  const projects = await api().get('/api/projects').set(auth(tokens.northwind));
  assert.deepEqual(projects.body.map((project) => project.id), [northwindProject]);
  for (const path of ['/api/projects/project-alpha', '/api/projects/project-alpha/members', '/api/projects/project-alpha/tasks', '/api/projects/project-alpha/summary', '/api/projects/project-alpha/tasks/export.csv']) {
    const response = await api().get(path).set(auth(tokens.northwind));
    assert.equal(response.status, 404, `${path}: ${response.text}`);
  }
  assert.equal((await api().get('/api/tasks/task-001').set(auth(tokens.northwind))).status, 404);
  assert.equal((await api().patch('/api/projects/project-alpha').set(auth(tokens.northwind)).send({ name: 'Hijacked' })).status, 404);
  assert.equal((await api().delete('/api/projects/project-alpha').set(auth(tokens.northwind))).status, 404);
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(tokens.northwind)).send({ title: 'Planted' })).status, 404);
  assert.equal((await Project.findById('project-alpha').lean()).name, 'Alpha Project');

  // The "all my tasks" and dashboard views are scoped too, even for an Admin.
  assert.deepEqual((await api().get('/api/tasks').set(auth(tokens.northwind))).body, []);
  assert.deepEqual((await api().get('/api/dashboard').set(auth(tokens.northwind))).body.projects.map((p) => p.projectId), [northwindProject]);

  // Open projects are open to their own organisation only.
  const directory = await api().get('/api/projects/directory').set(auth(tokens.outsider));
  assert.deepEqual(directory.body, [], "Northwind's open project is not in Acme's directory");
  const peek = await api().get(`/api/projects/${northwindProject}`).set(auth(tokens.outsider));
  assert.equal(peek.status, 404);
  assert.equal((await api().post(`/api/projects/${northwindProject}/join`).set(auth(tokens.outsider))).status, 404);
  assert.equal((await api().post('/api/projects/project-alpha/join').set(auth(tokens.northwind))).status, 404);
  assert.deepEqual((await Project.findById(northwindProject).lean()).memberIds, ['user-northwind-001']);

  // Even an Acme admin cannot add, or look up, someone registered in another organisation.
  const add = await api().post('/api/projects/project-alpha/members').set(auth(tokens.admin)).send({ email: 'northwind-admin@example.test' });
  assert.equal(add.status, 404);
  assert.equal(add.body.fields.email, 'Email is not registered in your organisation.');
  assert.equal((await api().get('/api/projects').set(auth(tokens.admin))).body.some((project) => project.id === northwindProject), false);

  // People management is per organisation: lists, role changes and deactivation.
  const acmePeople = await api().get('/api/users').set(auth(tokens.admin));
  assert.equal(acmePeople.body.total, 6);
  assert.ok(acmePeople.body.items.every((user) => user.id !== 'user-northwind-001'));
  const northwindPeople = await api().get('/api/users').set(auth(tokens.northwind));
  assert.deepEqual(northwindPeople.body.items.map((user) => user.id), ['user-northwind-001']);
  assert.equal((await api().patch('/api/users/user-member-001/role').set(auth(tokens.northwind)).send({ role: 'Admin' })).status, 404);
  assert.equal((await api().patch('/api/users/user-member-001/status').set(auth(tokens.northwind)).send({ active: false })).status, 404);
  assert.equal((await api().patch('/api/users/user-northwind-001/role').set(auth(tokens.admin)).send({ role: 'Member' })).status, 404);
  assert.equal((await User.findById('user-member-001').lean()).role, 'Member');
  assert.equal((await User.findById('user-member-001').lean()).deactivatedAt, null);
});

test('each organisation needs its own last Admin, and has its own settings', async () => {
  // Acme has an Admin but Northwind's only Admin still cannot be demoted.
  const northwindAdmin = await api().patch('/api/users/user-northwind-001/role').set(auth(tokens.northwind)).send({ role: 'Member' });
  assert.equal(northwindAdmin.status, 409);
  assert.equal(northwindAdmin.body.errorCode, 'LAST_ADMIN');
  assert.equal((await User.findById('user-northwind-001').lean()).role, 'Admin');

  const limited = await api().patch('/api/settings').set(auth(tokens.northwind)).send({ projectCreation: 'leads' });
  assert.equal(limited.status, 200);
  assert.deepEqual((await api().get('/api/settings').set(auth(tokens.member))).body, { projectCreation: 'everyone' });
  assert.equal((await api().post('/api/projects').set(auth(tokens.member)).send({ name: 'Still allowed' })).status, 201);
  assert.deepEqual((await api().get('/api/settings').set(auth(tokens.northwind))).body, { projectCreation: 'leads' });
});

test('new projects belong to their creator\'s organisation', async () => {
  const created = await api().post('/api/projects').set(auth(tokens.northwind)).send({ name: 'Northwind launch' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.organisationId, 'org-northwind');
  assert.equal((await api().get(`/api/projects/${created.body.id}`).set(auth(tokens.admin))).status, 404);
});

test('the organisation endpoint shows the invite code to Admins only', async () => {
  const admin = await api().get('/api/organisation').set(auth(tokens.admin));
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body, {
    id: 'org-acme', name: 'Acme Labs', projectCreation: 'everyone', createdAt: admin.body.createdAt,
    memberCount: 6, projectCount: 2, joinCode: 'ACMEL-ABS',
  });
  const member = await api().get('/api/organisation').set(auth(tokens.member));
  assert.equal(member.status, 200);
  assert.equal(member.body.joinCode, undefined);
  assert.equal(member.body.projectCount, undefined);
  assert.equal(member.body.memberCount, 6);
  assert.equal((await api().get('/api/organisation')).status, 401);

  await api().patch('/api/users/user-viewer-001/status').set(auth(tokens.admin)).send({ active: false });
  assert.equal((await api().get('/api/organisation').set(auth(tokens.admin))).body.memberCount, 5, 'deactivated accounts are not counted');
});

test('an Admin renames the organisation (audited) and rotates the invite code (audited without the code)', async () => {
  assert.equal((await api().patch('/api/organisation').set(auth(tokens.lead)).send({ name: 'Mine now' })).status, 403);
  assert.equal((await api().patch('/api/organisation').set(auth(tokens.admin)).send({})).status, 400);
  assert.equal((await api().patch('/api/organisation').set(auth(tokens.admin)).send({ name: '   ' })).status, 400);
  const renamed = await api().patch('/api/organisation').set(auth(tokens.admin)).send({ name: 'Acme Labs International' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.name, 'Acme Labs International');
  assert.deepEqual(logRecords.find((record) => record.route === '/api/organisation' && record.change)?.change, { field: 'organisationName', from: 'Acme Labs', to: 'Acme Labs International' });
  assert.equal((await api().get('/api/auth/me').set(auth(tokens.member))).body.organisation.name, 'Acme Labs International');

  assert.equal((await api().post('/api/organisation/join-code').set(auth(tokens.member))).status, 403);
  const rotated = await api().post('/api/organisation/join-code').set(auth(tokens.admin));
  assert.equal(rotated.status, 200, rotated.text);
  assert.match(rotated.body.joinCode, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.notEqual(rotated.body.joinCode, 'ACMEL-ABS');
  const audit = logRecords.find((record) => record.route === '/api/organisation/join-code' && record.change);
  assert.deepEqual(audit?.change, { field: 'joinCode', from: 'previous', to: 'rotated' });
  assert.equal(JSON.stringify(logRecords).includes(rotated.body.joinCode.replace('-', '')), false, 'the code is never logged');

  const body = { name: 'Late', email: 'late@example.test', password: PASSWORD };
  assert.equal((await api().post('/api/auth/register').send({ ...body, joinCode: 'ACMELABS' })).status, 400, 'the old code stops working at once');
  assert.equal((await api().post('/api/auth/register').send({ ...body, joinCode: rotated.body.joinCode })).status, 201, 'the new one works (with its dash)');
});

test('the overview lists the projects you are in and the open ones; Admins see every project', async () => {
  const open = await api().post('/api/projects').set(auth(tokens.lead)).send({ name: 'Design system', visibility: 'open' });
  assert.equal(open.status, 201);

  const admin = (await api().get('/api/organisation/overview?today=2026-10-16').set(auth(tokens.admin))).body;
  assert.deepEqual(admin.projects.map((project) => project.name), ['Alpha Project', 'Beta Project', 'Design system']);
  assert.equal(admin.totals.projects, 3);
  assert.equal(admin.totals.people, 6);

  const member = (await api().get('/api/organisation/overview?today=2026-10-16').set(auth(tokens.member))).body;
  assert.deepEqual(member.projects.map((project) => [project.name, project.yourRole]), [['Alpha Project', 'Member'], ['Design system', null]]);
  const alpha = member.projects[0];
  assert.deepEqual(Object.keys(alpha).sort(), ['counts', 'description', 'id', 'memberCount', 'name', 'overdue', 'ownerName', 'total', 'updatedAt', 'visibility', 'yourRole']);
  assert.equal(alpha.ownerName, 'Synthetic Lead');
  assert.equal(alpha.memberCount, 4);
  assert.equal(alpha.total, alpha.counts['To Do'] + alpha.counts['In Progress'] + alpha.counts.Done);
  assert.equal(member.totals.tasks, member.projects.reduce((sum, project) => sum + project.total, 0));

  const outsider = (await api().get('/api/organisation/overview').set(auth(tokens.outsider))).body;
  assert.deepEqual(outsider.projects.map((project) => project.name), ['Design system'], 'private projects stay hidden from people outside them');

  const northwind = (await api().get('/api/organisation/overview').set(auth(tokens.northwind))).body;
  assert.deepEqual(northwind.projects.map((project) => project.name), ['Northwind Roadmap']);
  assert.equal(northwind.totals.people, 1);
});

test('startup migration moves accounts and projects from before organisations into one default organisation', async () => {
  // Recreate the old shape: no organisations, no organisationId, and a global "leads" setting.
  await Organisation.deleteMany({});
  await User.collection.updateMany({}, { $unset: { organisationId: '' } });
  await Project.collection.updateMany({}, { $unset: { organisationId: '' } });
  const settings = mongoose.connection.db.collection('settings');
  await settings.replaceOne({ _id: 'workspace' }, { _id: 'workspace', projectCreation: 'leads' }, { upsert: true });
  try {
    const info = [];
    await runMigrations({ logger: { info: (line) => info.push(line) } });
    assert.ok(info.some((line) => line.includes('"name":"organisations"')));

    const organisations = await Organisation.find({}).lean();
    assert.equal(organisations.length, 1);
    assert.equal(organisations[0]._id, DEFAULT_ORGANISATION_ID);
    assert.equal(organisations[0].projectCreation, 'leads', 'the old global setting carries over');
    assert.match(organisations[0].joinCode, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(await User.countDocuments({ organisationId: DEFAULT_ORGANISATION_ID }), 7);
    assert.equal(await Project.countDocuments({ organisationId: DEFAULT_ORGANISATION_ID }), 3);

    // Safe to run again (and on every start): nothing changes.
    const before = organisations[0].joinCode;
    const again = [];
    await runMigrations({ logger: { info: (line) => again.push(line) } });
    assert.equal(again.some((line) => line.includes('"name":"organisations"')), false);
    assert.equal((await Organisation.findById(DEFAULT_ORGANISATION_ID).lean()).joinCode, before);

    // Existing people keep working in the migrated organisation.
    const admin = await signIn('admin@example.test');
    assert.equal((await api().get('/api/projects').set(auth(admin))).body.length, 3);
    assert.equal((await api().get('/api/auth/me').set(auth(admin))).body.organisation.name, 'My organisation');
  } finally {
    await settings.deleteOne({ _id: 'workspace' });
  }
});

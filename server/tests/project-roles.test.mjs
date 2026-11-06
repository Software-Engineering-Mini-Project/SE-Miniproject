// Project roles (Owner, Manager, Member, Viewer), ownership transfer, leaving a project,
// account deactivation and the project-role migration. Fixtures: Alpha is owned by the Lead
// and has a Viewer; in Beta (owned by the Admin) the Lead is a Manager.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { Comment, Project, Task, User } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';
import { seedDatabase } from '../utils/seed-database.js';
import { migrateProjectRoles } from '../utils/migrations.js';

const JWT_SECRET = 'project-role-tests-use-a-secret-long-enough-for-hs256';
const logRecords = [];
const app = createApp({ jwtSecret: JWT_SECRET, jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

let database;

async function login(email, password = 'Password123!') {
  const response = await api().post('/api/auth/login').send({ email, password });
  assert.equal(response.status, 200, response.text);
  return response.body.token;
}

const roles = (members) => Object.fromEntries(members.map((member) => [member.id, member.projectRole]));

before(async () => { database = await startTestDatabase(); });
beforeEach(async () => { await seedDatabase(); logRecords.length = 0; });
after(async () => { await database?.stop(); });

test('a Viewer can read and comment but cannot change tasks or be assigned', async () => {
  const viewer = await login('viewer@example.test');
  const lead = await login('lead@example.test');
  assert.equal((await api().get('/api/projects/project-alpha').set(auth(viewer))).status, 200);
  assert.equal((await api().get('/api/projects/project-alpha/tasks').set(auth(viewer))).status, 200);
  assert.equal((await api().get('/api/projects/project-alpha/tasks/export.csv').set(auth(viewer))).status, 200);

  const status = await api().patch('/api/tasks/task-001/status').set(auth(viewer)).send({ status: 'Done' });
  assert.equal(status.status, 403);
  assert.equal(status.body.message, 'Viewers cannot change task status.');
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(viewer)).send({ title: 'Nope' })).status, 403);
  assert.equal((await api().patch('/api/tasks/task-001').set(auth(viewer)).send({ title: 'Nope' })).status, 403);
  assert.equal((await api().delete('/api/tasks/task-001').set(auth(viewer))).status, 403);
  assert.equal((await api().post('/api/projects/project-alpha/members').set(auth(viewer)).send({ email: 'outsider@example.test' })).status, 403);

  const comment = await api().post('/api/tasks/task-001/comments').set(auth(viewer)).send({ text: 'Looks good from the client side.' });
  assert.equal(comment.status, 201, comment.text);
  // The Viewer can delete their own comment but not someone else's.
  const others = await Comment.findOne({ taskId: 'task-001', authorId: { $ne: 'user-viewer-001' } }).lean();
  if (others) assert.equal((await api().delete(`/api/tasks/task-001/comments/${others._id}`).set(auth(viewer))).status, 403);
  assert.equal((await api().delete(`/api/tasks/task-001/comments/${comment.body.id}`).set(auth(viewer))).status, 204);

  const assigned = await api().patch('/api/tasks/task-001').set(auth(lead)).send({ assigneeIds: ['user-viewer-001'] });
  assert.equal(assigned.status, 400);
  assert.equal(assigned.body.fields.assigneeIds, 'Viewers cannot be assigned tasks.');
});

test('a Manager edits the project and manages members, but cannot delete it or grant Manager', async () => {
  // The Lead is a Manager in Beta, which the Admin owns.
  const lead = await login('lead@example.test');
  const renamed = await api().patch('/api/projects/project-beta').set(auth(lead)).send({ name: 'Beta, renamed' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal((await api().post('/api/projects/project-beta/tasks').set(auth(lead)).send({ title: 'Manager task' })).status, 201);

  const deleted = await api().delete('/api/projects/project-beta').set(auth(lead));
  assert.equal(deleted.status, 403);
  assert.equal(deleted.body.message, 'Only the project owner or an admin can delete this project.');

  const asManager = await api().post('/api/projects/project-beta/members').set(auth(lead)).send({ email: 'member@example.test', role: 'Manager' });
  assert.equal(asManager.status, 403);
  const asViewer = await api().post('/api/projects/project-beta/members').set(auth(lead)).send({ email: 'member@example.test', role: 'Viewer' });
  assert.equal(asViewer.status, 200, asViewer.text);
  assert.equal(roles(asViewer.body)['user-member-001'], 'Viewer');
  const toMember = await api().patch('/api/projects/project-beta/members/user-member-001').set(auth(lead)).send({ role: 'Member' });
  assert.equal(roles(toMember.body)['user-member-001'], 'Member');
  assert.equal((await api().patch('/api/projects/project-beta/members/user-member-001').set(auth(lead)).send({ role: 'Manager' })).status, 403);
  // The owner can't be demoted or removed, by anyone.
  assert.equal((await api().patch('/api/projects/project-beta/members/user-admin-001').set(auth(lead)).send({ role: 'Member' })).status, 400);
  assert.equal((await api().delete('/api/projects/project-beta/members/user-admin-001').set(auth(lead))).status, 400);
  assert.equal((await api().post('/api/projects/project-beta/members').set(auth(lead)).send({ email: 'member@example.test', role: 'Owner' })).status, 400);
});

test('only the Owner (or an Admin) grants Manager; a promoted Member gains task rights at once', async () => {
  const lead = await login('lead@example.test');
  const member = await login('member@example.test');
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(member)).send({ title: 'Too early' })).status, 403);

  const promoted = await api().patch('/api/projects/project-alpha/members/user-member-001').set(auth(lead)).send({ role: 'Manager' });
  assert.equal(promoted.status, 200, promoted.text);
  assert.equal(roles(promoted.body)['user-member-001'], 'Manager');
  const audit = logRecords.find((record) => record.route === '/api/projects/:projectId/members/:userId' && record.change);
  assert.deepEqual(audit?.change, { field: 'projectRole', from: 'Member', to: 'Manager' });

  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(member)).send({ title: 'Now allowed' })).status, 201);
  // A Manager can't remove or demote another Manager, and can't delete the project.
  await api().patch('/api/projects/project-alpha/members/user-member-002').set(auth(lead)).send({ role: 'Manager' });
  assert.equal((await api().delete('/api/projects/project-alpha/members/user-member-002').set(auth(member))).status, 403);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-member-002').set(auth(member)).send({ role: 'Member' })).status, 403);
  assert.equal((await api().delete('/api/projects/project-alpha').set(auth(member))).status, 403);
  // A plain Member can't change roles at all.
  const plain = await login('member.two.with.a.long.address@example.test');
  await api().patch('/api/projects/project-alpha/members/user-member-002').set(auth(lead)).send({ role: 'Member' });
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-viewer-001').set(auth(plain)).send({ role: 'Member' })).status, 403);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-viewer-001').set(auth(lead)).send({ role: 'Admin' })).status, 400);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-outsider-001').set(auth(lead)).send({ role: 'Member' })).status, 404);
});

test('changing someone to Viewer unassigns them; ownership transfers and the old owner becomes a Manager', async () => {
  const lead = await login('lead@example.test');
  assert.ok(await Task.countDocuments({ projectId: 'project-alpha', assigneeIds: 'user-member-001' }) > 0);
  const viewer = await api().patch('/api/projects/project-alpha/members/user-member-001').set(auth(lead)).send({ role: 'Viewer' });
  assert.equal(viewer.status, 200, viewer.text);
  assert.equal(await Task.countDocuments({ projectId: 'project-alpha', assigneeIds: 'user-member-001' }), 0);

  const transferred = await api().patch('/api/projects/project-alpha/members/user-member-002').set(auth(lead)).send({ role: 'Owner' });
  assert.equal(transferred.status, 200, transferred.text);
  assert.equal(roles(transferred.body)['user-member-002'], 'Owner');
  assert.equal(roles(transferred.body)['user-lead-001'], 'Manager');
  const project = await Project.findById('project-alpha').lean();
  assert.equal(project.ownerId, 'user-member-002');
  assert.deepEqual(project.managerIds, ['user-lead-001']);

  // The former owner lost the owner-only rights.
  assert.equal((await api().delete('/api/projects/project-alpha').set(auth(lead))).status, 403);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-member-002').set(auth(lead)).send({ role: 'Owner' })).status, 200);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-lead-001').set(auth(lead)).send({ role: 'Owner' })).status, 403);
  const newOwner = await login('member.two.with.a.long.address@example.test');
  assert.equal((await api().delete('/api/projects/project-alpha').set(auth(newOwner))).status, 204);
});

test('any non-owner member can leave a project; the owner cannot', async () => {
  const member = await login('member.two.with.a.long.address@example.test');
  const left = await api().delete('/api/projects/project-alpha/members/user-member-002').set(auth(member));
  assert.equal(left.status, 200, left.text);
  assert.equal(left.body.some((item) => item.id === 'user-member-002'), false);
  assert.equal((await api().get('/api/projects/project-alpha').set(auth(member))).status, 403);
  const lead = await login('lead@example.test');
  const ownerLeaves = await api().delete('/api/projects/project-alpha/members/user-lead-001').set(auth(lead));
  assert.equal(ownerLeaves.status, 400);
  assert.match(ownerLeaves.body.message, /Transfer ownership first/);
  // Non-members get 403 before anything else is revealed.
  const outsider = await login('outsider@example.test');
  assert.equal((await api().delete('/api/projects/project-alpha/members/user-member-001').set(auth(outsider))).status, 403);
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-member-001').set(auth(outsider)).send({ role: 'Viewer' })).status, 403);
});

test('a workspace Lead has no rights in a project they are not a member of; Admins have all', async () => {
  const admin = await login('admin@example.test');
  await api().patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Lead' });
  const outsiderLead = await login('outsider@example.test');
  assert.equal((await api().patch('/api/projects/project-alpha').set(auth(outsiderLead)).send({ name: 'Hijack' })).status, 403);
  // Admin, not an Alpha member, can do owner-level actions but can't be assigned there.
  assert.equal((await api().patch('/api/projects/project-alpha/members/user-member-001').set(auth(admin)).send({ role: 'Manager' })).status, 200);
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(admin)).send({ title: 'Admin task' })).status, 201);
  assert.equal((await api().post('/api/projects/project-alpha/tasks').set(auth(admin)).send({ title: 'x', assigneeIds: ['user-admin-001'] })).status, 400);
});

test('Admins deactivate and reactivate accounts; a deactivated account is signed out and cannot sign in', async () => {
  const admin = await login('admin@example.test');
  const member = await login('member@example.test');
  const lead = await login('lead@example.test');
  assert.equal((await api().patch('/api/users/user-member-001/status').set(auth(lead)).send({ active: false })).status, 403);
  assert.equal((await api().patch('/api/users/user-member-001/status').set(auth(admin)).send({ active: 'no' })).status, 400);
  assert.equal((await api().patch('/api/users/user-admin-001/status').set(auth(admin)).send({ active: false })).status, 400);

  const deactivated = await api().patch('/api/users/user-member-001/status').set(auth(admin)).send({ active: false });
  assert.equal(deactivated.status, 200, deactivated.text);
  assert.equal(deactivated.body.active, false);
  const audit = logRecords.find((record) => record.route === '/api/users/:userId/status');
  assert.deepEqual(audit?.change, { field: 'status', from: 'active', to: 'deactivated' });

  const session = await api().get('/api/auth/me').set(auth(member));
  assert.equal(session.status, 401);
  assert.equal(session.body.errorCode, 'ACCOUNT_DEACTIVATED');
  const signIn = await api().post('/api/auth/login').send({ email: 'member@example.test', password: 'Password123!' });
  assert.equal(signIn.status, 403);
  assert.equal(signIn.body.errorCode, 'ACCOUNT_DEACTIVATED');
  assert.equal(signIn.body.token, undefined);
  // A wrong password still reads as a plain bad credential, so deactivation isn't disclosed.
  const wrong = await api().post('/api/auth/login').send({ email: 'member@example.test', password: 'Wrong-password-1' });
  assert.equal(wrong.status, 401);

  const listed = await api().get('/api/users?status=deactivated').set(auth(admin));
  assert.deepEqual(listed.body.items.map((user) => user.id), ['user-member-001']);
  assert.equal(listed.body.deactivatedCount, 1);
  assert.equal((await api().get('/api/users?status=gone').set(auth(admin))).status, 400);

  await api().delete('/api/projects/project-alpha/members/user-member-001').set(auth(lead));
  const readd = await api().post('/api/projects/project-alpha/members').set(auth(lead)).send({ email: 'member@example.test' });
  assert.equal(readd.status, 400);
  assert.equal(readd.body.fields.email, 'This account is deactivated.');

  assert.equal((await api().patch('/api/users/user-member-001/status').set(auth(admin)).send({ active: true })).status, 200);
  assert.equal((await api().get('/api/auth/me').set(auth(await login('member@example.test')))).status, 200);
  // The old session stays revoked after reactivation.
  assert.equal((await api().get('/api/auth/me').set(auth(member))).status, 401);
});

test('a deactivated Admin does not count toward the last-Admin guard', async () => {
  const admin = await login('admin@example.test');
  await api().patch('/api/users/user-lead-001/role').set(auth(admin)).send({ role: 'Admin' });
  await api().patch('/api/users/user-lead-001/status').set(auth(admin)).send({ active: false });
  const stepDown = await api().patch('/api/users/user-admin-001/role').set(auth(admin)).send({ role: 'Member' });
  assert.equal(stepDown.status, 409);
  assert.equal(stepDown.body.errorCode, 'LAST_ADMIN');
  await User.updateOne({ _id: 'user-lead-001' }, { $set: { role: 'Lead', deactivatedAt: null } });
});

test('the migration makes non-owner Lead members Managers once, and leaves migrated projects alone', async () => {
  await Project.collection.insertOne({
    _id: 'legacy-project', name: 'Legacy', description: '', ownerId: 'user-admin-001',
    memberIds: ['user-admin-001', 'user-lead-001', 'user-member-001'], createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(await migrateProjectRoles(), 1);
  const migrated = await Project.findById('legacy-project').lean();
  assert.deepEqual(migrated.managerIds, ['user-lead-001']);
  assert.deepEqual(migrated.viewerIds, []);
  // Beta already has role arrays; Alpha's owner is the Lead. Neither changes.
  assert.deepEqual((await Project.findById('project-alpha').lean()).managerIds, []);

  await Project.updateOne({ _id: 'legacy-project' }, { $set: { managerIds: [] } });
  assert.equal(await migrateProjectRoles(), 0);
  assert.deepEqual((await Project.findById('legacy-project').lean()).managerIds, []);
});

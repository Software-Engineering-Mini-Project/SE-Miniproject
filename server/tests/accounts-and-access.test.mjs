// Session revocation, Admin user management (SRS §2.2), member-removal cleanup, registration limiter order.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../app.js';
import { Notification, Task, User } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';

const JWT_SECRET = 'account-tests-use-a-secret-long-enough-for-hs256';
const logRecords = [];
const app = createApp({ jwtSecret: JWT_SECRET, jwtExpiresIn: 7200, logger: (record) => logRecords.push(record) });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

let database;

async function login(email, password = 'Password123!') {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(response.status, 200, response.text);
  return response.body.token;
}

before(async () => {
  database = await startTestDatabase();
});

after(async () => {
  await database?.stop();
});

test('a password change revokes earlier sessions and returns a working replacement token', async () => {
  const [first, second] = [await login('member@example.test'), await login('member@example.test')];
  const changed = await request(app).patch('/api/users/me').set(auth(first)).send({
    currentPassword: 'Password123!', newPassword: 'Rotated12345',
  });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(changed.body.id, 'user-member-001');
  assert.equal(typeof changed.body.token, 'string');
  assert.equal(changed.body.expiresIn, 7200);
  assert.equal(changed.body.passwordHash, undefined);
  assert.equal(changed.body.tokenVersion, undefined);

  for (const stale of [first, second]) {
    const response = await request(app).get('/api/auth/me').set(auth(stale));
    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, 'TOKEN_REVOKED');
  }
  const fresh = await request(app).get('/api/auth/me').set(auth(changed.body.token));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.tokenVersion, undefined);

  // A name-only change neither revokes sessions nor issues a token.
  const renamed = await request(app).patch('/api/users/me').set(auth(changed.body.token)).send({ name: 'Synthetic Member' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.token, undefined);
  assert.equal((await request(app).get('/api/auth/me').set(auth(changed.body.token))).status, 200);

  const restored = await request(app).patch('/api/users/me').set(auth(changed.body.token)).send({
    currentPassword: 'Rotated12345', newPassword: 'Password123!',
  });
  assert.equal(restored.status, 200);
});

test('tokens issued before token versions existed keep working until the first password change', async () => {
  const legacy = jwt.sign({}, JWT_SECRET, { subject: 'user-lead-001', expiresIn: 600, algorithm: 'HS256' });
  assert.equal((await request(app).get('/api/auth/me').set(auth(legacy))).status, 200);
  await User.updateOne({ _id: 'user-lead-001' }, { $set: { tokenVersion: 1 } });
  assert.equal((await request(app).get('/api/auth/me').set(auth(legacy))).status, 401);
  await User.updateOne({ _id: 'user-lead-001' }, { $set: { tokenVersion: 0 } });
});

test('only Admins can list users, with search, role filter, paging, role totals and project counts', async () => {
  const [admin, lead] = [await login('admin@example.test'), await login('lead@example.test')];
  assert.equal((await request(app).get('/api/users').set(auth(lead))).status, 403);
  assert.equal((await request(app).get('/api/users')).status, 401);

  const all = await request(app).get('/api/users').set(auth(admin));
  assert.equal(all.status, 200, all.text);
  assert.equal(all.body.total, 6);
  assert.deepEqual(all.body.roleCounts, { Admin: 1, Lead: 1, Member: 4 });
  assert.equal(all.body.deactivatedCount, 0);
  assert.ok(all.body.items.every((user) => user.active === true));
  assert.equal(all.body.page, 1);
  const lead1 = all.body.items.find((user) => user.id === 'user-lead-001');
  assert.equal(lead1.projectCount, 2);
  assert.equal(all.body.items.find((user) => user.id === 'user-outsider-001').projectCount, 0);
  assert.doesNotMatch(JSON.stringify(all.body), /passwordHash|tokenVersion|emailNormalized/);

  const searched = await request(app).get('/api/users?q=LONG.address').set(auth(admin));
  assert.deepEqual(searched.body.items.map((user) => user.id), ['user-member-002']);
  const regexSafe = await request(app).get('/api/users?q=.*').set(auth(admin));
  assert.equal(regexSafe.body.total, 0);
  const members = await request(app).get('/api/users?role=Member&pageSize=2').set(auth(admin));
  assert.equal(members.body.total, 4);
  assert.equal(members.body.items.length, 2);
  assert.equal((await request(app).get('/api/users?role=Owner').set(auth(admin))).status, 400);
  assert.equal((await request(app).get('/api/users?pageSize=1000').set(auth(admin))).status, 400);
});

test('Admins change roles; the change takes effect at once, is audited, and the last Admin is protected', async () => {
  const admin = await login('admin@example.test');
  const outsider = await login('outsider@example.test');
  // With project creation limited to leads, a Member can't create one until promoted.
  assert.equal((await request(app).patch('/api/settings').set(auth(admin)).send({ projectCreation: 'leads' })).status, 200);
  const blocked = await request(app).post('/api/projects').set(auth(outsider)).send({ name: 'Before promotion' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.message, /only leads and admins can create projects/);

  const forbidden = await request(app).patch('/api/users/user-outsider-001/role').set(auth(outsider)).send({ role: 'Admin' });
  assert.equal(forbidden.status, 403);

  logRecords.length = 0;
  const promoted = await request(app).patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Lead' });
  assert.equal(promoted.status, 200, promoted.text);
  assert.equal(promoted.body.role, 'Lead');
  const audit = logRecords.find((record) => record.audit && record.route === '/api/users/:userId/role');
  assert.deepEqual(audit.change, { field: 'role', from: 'Member', to: 'Lead' });
  assert.deepEqual(audit.targetIds, { userId: 'user-outsider-001' });

  // The same token now has Lead rights: roles are read from the database on every request.
  const created = await request(app).post('/api/projects').set(auth(outsider)).send({ name: 'After promotion' });
  assert.equal(created.status, 201, created.text);
  await request(app).patch('/api/settings').set(auth(admin)).send({ projectCreation: 'everyone' });

  assert.equal((await request(app).patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Owner' })).status, 400);
  assert.equal((await request(app).patch('/api/users/no-such-user/role').set(auth(admin)).send({ role: 'Lead' })).status, 404);
  assert.equal((await request(app).patch('/api/users/$bad/role').set(auth(admin)).send({ role: 'Lead' })).status, 400);
  const unchanged = await request(app).patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Lead' });
  assert.equal(unchanged.status, 200);

  const lastAdmin = await request(app).patch('/api/users/user-admin-001/role').set(auth(admin)).send({ role: 'Member' });
  assert.equal(lastAdmin.status, 409);
  assert.equal(lastAdmin.body.errorCode, 'LAST_ADMIN');
  assert.equal((await User.findById('user-admin-001')).role, 'Admin');

  // With a second Admin, an Admin may step down.
  assert.equal((await request(app).patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Admin' })).status, 200);
  const stepDown = await request(app).patch('/api/users/user-admin-001/role').set(auth(admin)).send({ role: 'Lead' });
  assert.equal(stepDown.status, 200, stepDown.text);
  assert.equal((await request(app).get('/api/users').set(auth(admin))).status, 403);

  const newAdmin = await login('outsider@example.test');
  await request(app).patch('/api/users/user-admin-001/role').set(auth(newAdmin)).send({ role: 'Admin' });
  await request(app).patch('/api/users/user-outsider-001/role').set(auth(admin)).send({ role: 'Member' });
  assert.deepEqual(
    (await User.find({ organisationId: 'org-acme' }).sort({ _id: 1 }).lean()).map((user) => [user._id, user.role]),
    [['user-admin-001', 'Admin'], ['user-lead-001', 'Lead'], ['user-member-001', 'Member'], ['user-member-002', 'Member'], ['user-outsider-001', 'Member'], ['user-viewer-001', 'Member']],
  );
});

test('removing a member drops only their notifications for that project and only touches their tasks', async () => {
  const lead = await login('lead@example.test');
  await Notification.create({ userId: 'user-member-001', taskId: 'task-003', projectId: 'project-beta', type: 'assignment', message: 'other project', read: false });
  const untouchedBefore = (await Task.findById('task-006').lean()).updatedAt.toISOString();
  const otherMemberNotifications = await Notification.countDocuments({ userId: 'user-member-002' });
  assert.ok(await Notification.countDocuments({ userId: 'user-member-001', projectId: 'project-alpha' }) > 0);

  const removed = await request(app).delete('/api/projects/project-alpha/members/user-member-001').set(auth(lead));
  assert.equal(removed.status, 200, removed.text);

  assert.equal(await Notification.countDocuments({ userId: 'user-member-001', projectId: 'project-alpha' }), 0);
  assert.equal(await Notification.countDocuments({ userId: 'user-member-001', projectId: 'project-beta' }), 1);
  assert.equal(await Notification.countDocuments({ userId: 'user-member-002' }), otherMemberNotifications);
  assert.equal((await Task.findById('task-006').lean()).updatedAt.toISOString(), untouchedBefore);
  assert.equal(await Task.countDocuments({ projectId: 'project-alpha', assigneeIds: 'user-member-001' }), 0);

  const member = await login('member@example.test');
  const feed = await request(app).get('/api/notifications').set(auth(member));
  assert.equal(feed.body.items.some((item) => item.projectId === 'project-alpha'), false);
  assert.equal((await request(app).post('/api/projects/project-alpha/members').set(auth(lead)).send({ email: 'member@example.test' })).status, 200);
});

test('invalid registrations do not use up the per-IP registration limit, and duplicates are caught without the index', async () => {
  const ip = '203.0.113.77';
  const typos = await Promise.all(Array.from({ length: 6 }, () => request(app)
    .post('/api/auth/register').set('X-Forwarded-For', ip).send({ name: 'Typo', email: 'not-an-email', password: 'short' })));
  assert.deepEqual(typos.map((response) => response.status), [400, 400, 400, 400, 400, 400]);
  const valid = await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({
    name: 'After Typos', email: 'after-typos@example.test', password: 'Password123', joinCode: 'ACMELABS',
  });
  assert.equal(valid.status, 201, valid.text);

  await User.collection.dropIndex('emailNormalized_1');
  try {
    const duplicate = await request(app).post('/api/auth/register').set('X-Forwarded-For', '203.0.113.78').send({
      name: 'Duplicate', email: 'AFTER-TYPOS@example.test', password: 'Password123', joinCode: 'ACMELABS',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.errorCode, 'DUPLICATE_EMAIL');
    assert.equal(await User.countDocuments({ emailNormalized: 'after-typos@example.test' }), 1);
  } finally {
    await User.syncIndexes();
  }
});

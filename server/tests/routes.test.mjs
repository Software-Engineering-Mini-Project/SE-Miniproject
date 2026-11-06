import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { Comment, LoginAttempt, Notification, Project, Task, User } from '../models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';

const JWT_SECRET = 'route-tests-use-a-secret-long-enough-for-hs256';
const FIXED_NOW = new Date('2026-10-16T12:00:00.000Z');
const logRecords = [];
const app = createApp({
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: 7200,
  now: () => FIXED_NOW,
  logger: (record) => logRecords.push(record),
});
// Rate-limit counters expire through a MongoDB TTL index, which compares against the real clock.
// Under FIXED_NOW (in the past) the counters already look expired, and the TTL monitor (every
// ~60 s) could delete them mid-test. The throttling tests use a clock a day ahead instead.
const LIMIT_NOW = new Date(Date.now() + 86_400_000);
const limitApp = createApp({ jwtSecret: JWT_SECRET, now: () => LIMIT_NOW, logger: () => {} });

let database;
let adminToken;
let leadToken;
let memberToken;
let secondMemberToken;
let outsiderToken;

before(async () => {
  database = await startTestDatabase();
  [adminToken, leadToken, memberToken, secondMemberToken, outsiderToken] = await Promise.all([
    'admin@example.test',
    'lead@example.test',
    'member@example.test',
    'member.two.with.a.long.address@example.test',
    'outsider@example.test',
  ].map(async (email) => {
    const response = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    assert.equal(response.status, 200, response.text);
    return response.body.token;
  }));
});

after(async () => {
  await database?.stop();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('registration, login, bearer auth, profile updates, and password changes follow the contract', async () => {
  const registration = await request(app).post('/api/auth/register').send({
    name: 'New Synthetic User',
    email: 'New.User@example.test',
    password: 'Password123!',
    role: 'Admin',
  });
  assert.equal(registration.status, 201, registration.text);
  assert.deepEqual(registration.body, { userId: registration.body.userId, email: 'New.User@example.test' });
  const registered = await User.findById(registration.body.userId).select('+passwordHash');
  assert.equal(registered.role, 'Member');
  assert.equal(await bcrypt.compare('Password123!', registered.passwordHash), true);
  assert.equal(JSON.stringify(registration.body).includes('password'), false);

  const login = await request(app).post('/api/auth/login').send({
    email: 'new.user@EXAMPLE.test',
    password: 'Password123!',
  });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.expiresIn, 7200);
  assert.equal(login.body.user.id, registration.body.userId);
  assert.equal(login.body.user.passwordHash, undefined);
  assert.match(login.headers['server-timing'], /db;dur=.*bcrypt;dur=.*total;dur=/);
  const me = await request(app).get('/api/auth/me').set(auth(login.body.token));
  assert.equal(me.status, 200);
  assert.equal(me.body.id, registration.body.userId);
  assert.equal(me.body.role, 'Member');
  assert.equal(me.body.passwordHash, undefined);

  const renamed = await request(app).patch('/api/users/me').set(auth(login.body.token)).send({ name: 'Updated User' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.name, 'Updated User');

  const passwordUpdate = await request(app).patch('/api/users/me').set(auth(login.body.token)).send({
    currentPassword: 'Password123!',
    newPassword: 'ChangedPass456',
  });
  assert.equal(passwordUpdate.status, 200, passwordUpdate.text);
  const newLogin = await request(app).post('/api/auth/login').send({ email: 'new.user@example.test', password: 'ChangedPass456' });
  assert.equal(newLogin.status, 200, newLogin.text);
  const oldLogin = await request(app).post('/api/auth/login').send({ email: 'new.user@example.test', password: 'Password123!' });
  assert.equal(oldLogin.status, 401);
  assert.equal(oldLogin.body.errorCode, 'INVALID_CREDENTIALS');

  const duplicate = await request(app).post('/api/auth/register').send({
    name: 'Duplicate', email: 'NEW.USER@example.test', password: 'Password123!',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.errorCode, 'DUPLICATE_EMAIL');
  assert.equal(duplicate.body.fields.email, 'This email is already registered.');
});

test('registration is limited to five attempts per client IP per ten minutes', async () => {
  const ip = '198.51.100.88';
  const registrations = await Promise.all(Array.from({ length: 5 }, (_, index) => request(limitApp)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ name: `Rate Limited ${index}`, email: `register-limit-${index}@example.test`, password: 'Password123!' })));
  assert.deepEqual(registrations.map((response) => response.status), [201, 201, 201, 201, 201]);
  const limited = await request(limitApp).post('/api/auth/register').set('X-Forwarded-For', ip).send({
    name: 'Must not be created', email: 'register-limit-six@example.test', password: 'Password123!',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.errorCode, 'RATE_LIMITED');
  assert.match(limited.body.message, /registration attempts/i);
  assert.equal(await User.exists({ emailNormalized: 'register-limit-six@example.test' }), null);
});

test('dashboard aggregates project totals and my tasks with membership scoping', async () => {
  const lead = await request(app).get('/api/dashboard').set(auth(leadToken));
  assert.equal(lead.status, 200, lead.text);
  const alpha = lead.body.projects.find((project) => project.projectId === 'project-alpha');
  const beta = lead.body.projects.find((project) => project.projectId === 'project-beta');
  assert.deepEqual(alpha, {
    projectId: 'project-alpha',
    total: 7,
    counts: { 'To Do': 3, 'In Progress': 2, Done: 2 },
    overdue: 1,
  });
  assert.deepEqual(beta, {
    projectId: 'project-beta',
    total: 3,
    counts: { 'To Do': 1, 'In Progress': 1, Done: 1 },
    overdue: 1,
  });
  assert.ok(lead.body.myTasks.every((task) => task.assigneeIds.includes('user-lead-001')));
  assert.ok(lead.body.myTasks.some((task) => task.id === 'task-009'));

  const member = await request(app).get('/api/dashboard').set(auth(memberToken));
  assert.deepEqual(member.body.projects.map((project) => project.projectId), ['project-alpha']);
  assert.ok(member.body.myTasks.every((task) => task.projectId === 'project-alpha'));
  const outsider = await request(app).get('/api/dashboard').set(auth(outsiderToken));
  assert.deepEqual(outsider.body, { projects: [], myTasks: [], stats: { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 } });
});

test('read-all updates only the signed-in user unread notifications in one operation', async () => {
  const records = await Notification.insertMany([
    { userId: 'user-outsider-001', taskId: 'task-001', type: 'assignment', message: 'Unread one', read: false },
    { userId: 'user-outsider-001', taskId: 'task-001', type: 'assignment', message: 'Unread two', read: false },
    { userId: 'user-outsider-001', taskId: 'task-001', type: 'assignment', message: 'Already read', read: true },
    { userId: 'user-member-001', taskId: 'task-001', type: 'assignment', message: 'Other user', read: false },
  ]);
  try {
    const response = await request(app).patch('/api/notifications/read-all').set(auth(outsiderToken));
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body, { updated: 2 });
    assert.equal(await Notification.countDocuments({ _id: { $in: records.slice(0, 3).map((record) => record.id) }, read: false }), 0);
    assert.equal(await Notification.countDocuments({ _id: records[3].id, read: false }), 1);
  } finally {
    await Notification.deleteMany({ _id: { $in: records.map((record) => record.id) } });
  }
});

test('task and project lists are paginated, lean-safe, and capped for legacy callers', async () => {
  const pageA = await request(app).get('/api/projects?page=1&pageSize=1').set(auth(leadToken));
  assert.equal(pageA.status, 200);
  assert.equal(pageA.body.length, 1);
  const pageB = await request(app).get('/api/projects?page=2&pageSize=1').set(auth(leadToken));
  assert.equal(pageB.body.length, 1);
  assert.notEqual(pageA.body[0].id, pageB.body[0].id);

  const inserted = await Task.insertMany(Array.from({ length: 501 }, (_, index) => ({
    _id: `page-bound-task-${String(index).padStart(3, '0')}`,
    projectId: 'project-alpha',
    title: `Page bound ${index}`,
    assigneeIds: [],
  })));
  try {
    const paged = await request(app).get('/api/projects/project-alpha/tasks?page=2&pageSize=2').set(auth(leadToken));
    assert.equal(paged.status, 200, paged.text);
    assert.equal(paged.body.length, 2);
    assert.ok(paged.body.every((task) => task.id && !('_id' in task) && !('__v' in task)));

    const legacy = await request(app).get('/api/tasks').set(auth(leadToken));
    assert.equal(legacy.status, 200, legacy.text);
    assert.equal(legacy.body.length, 500);

    const expectedCsvRows = await Task.countDocuments({ projectId: 'project-alpha' });
    const csv = await request(app)
      .get('/api/projects/project-alpha/tasks/export.csv?page=1&pageSize=1')
      .set(auth(leadToken));
    assert.equal(csv.status, 200);
    assert.equal(csv.text.trimEnd().split('\r\n').length, expectedCsvRows + 1);

    const tooLarge = await request(app).get('/api/tasks?pageSize=101').set(auth(leadToken));
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.body.errorCode, 'VALIDATION_ERROR');
  } finally {
    await Task.deleteMany({ _id: { $in: inserted.map((task) => task.id) } });
  }
});

test('successful login migrates a cost-12 password hash to cost 10', async () => {
  const email = 'migration@example.test';
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name: 'Migration', email, emailNormalized: email, passwordHash, role: 'Member' });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, user.id);
  const migrated = await User.findById(user.id).select('+passwordHash');
  assert.equal(bcrypt.getRounds(migrated.passwordHash), 10);
  assert.equal(await bcrypt.compare(password, migrated.passwordHash), true);
});

test('rehash failure does not prevent a valid login', async () => {
  const email = 'migration-failure@example.test';
  const password = 'Password123!';
  await User.create({ name: 'Migration Failure', email, emailNormalized: email, passwordHash: await bcrypt.hash(password, 12), role: 'Member' });
  const update = User.updateOne;
  const log = console.error;
  try {
    User.updateOne = () => { throw new Error('private database detail'); };
    console.error = () => {};
    const response = await request(app).post('/api/auth/login').send({ email, password });
    assert.equal(response.status, 200);
    assert.ok(response.body.token);
  } finally {
    User.updateOne = update;
    console.error = log;
  }
});

test('a deleted account cannot use an existing token', async () => {
  const email = 'deleted-user@example.test';
  const password = 'Password123!';
  const user = await User.create({ name: 'Deleted User', email, emailNormalized: email, passwordHash: await bcrypt.hash(password, 10), role: 'Member' });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(login.status, 200);
  await User.deleteOne({ _id: user._id });
  const response = await request(app).get('/api/auth/me').set(auth(login.body.token));
  assert.equal(response.status, 401);
});

test('authentication errors and failed-login throttling return stable envelopes', async () => {
  const unauthenticated = await request(app).get('/api/projects');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.errorCode, 'UNAUTHENTICATED');

  const malformed = await request(app).get('/api/projects').set(auth('not-a-jwt'));
  assert.equal(malformed.status, 401);
  assert.equal(malformed.body.errorCode, 'INVALID_TOKEN');

  const expiredToken = jwt.sign({}, JWT_SECRET, { subject: 'user-member-001', expiresIn: -1, algorithm: 'HS256' });
  const expired = await request(app).get('/api/projects').set(auth(expiredToken));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.errorCode, 'TOKEN_EXPIRED');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request(limitApp).post('/api/auth/login').send({
      email: 'rate-limit@example.test', password: 'WrongPassword123',
    }).set('X-Forwarded-For', '198.51.100.40');
    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, 'INVALID_CREDENTIALS');
  }
  const throttled = await request(limitApp).post('/api/auth/login').send({
    email: 'rate-limit@example.test', password: 'WrongPassword123',
  }).set('X-Forwarded-For', '198.51.100.40');
  assert.equal(throttled.status, 429);
  assert.equal(throttled.body.errorCode, 'RATE_LIMITED');

  const restartedApp = createApp({ jwtSecret: JWT_SECRET, now: () => LIMIT_NOW, logger: () => {} });
  const afterRestart = await request(restartedApp).post('/api/auth/login').send({
    email: 'rate-limit@example.test', password: 'WrongPassword123',
  }).set('X-Forwarded-For', '198.51.100.40');
  assert.equal(afterRestart.status, 429, 'the shared database preserves the limit across app instances');

  const afterWindowApp = createApp({
    jwtSecret: JWT_SECRET,
    now: () => new Date(LIMIT_NOW.getTime() + 60_001),
    logger: () => {},
  });
  const afterWindow = await request(afterWindowApp).post('/api/auth/login').send({
    email: 'rate-limit@example.test', password: 'WrongPassword123',
  }).set('X-Forwarded-For', '198.51.100.40');
  assert.equal(afterWindow.status, 401, 'the account/IP limit expires after its window');
});

test('failed login throttling also limits account spraying from one forwarded client IP', async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(limitApp).post('/api/auth/login').send({
      email: `spray-${attempt}@example.test`, password: 'WrongPassword123',
    }).set('X-Forwarded-For', '198.51.100.66');
    assert.equal(response.status, 401, `failed login ${attempt + 1}`);
  }
  const limited = await request(limitApp).post('/api/auth/login').send({
    email: 'spray-final@example.test', password: 'WrongPassword123',
  }).set('X-Forwarded-For', '198.51.100.66');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.errorCode, 'RATE_LIMITED');
});

test('login fails closed with a generic response when the shared limiter store is unavailable', async () => {
  const originalFind = LoginAttempt.find;
  LoginAttempt.find = () => { throw new Error('private database detail'); };
  try {
    const response = await request(app).post('/api/auth/login').send({
      email: 'limiter-unavailable@example.test', password: 'WrongPassword123',
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.errorCode, 'AUTH_RATE_LIMIT_UNAVAILABLE');
    assert.equal(JSON.stringify(response.body).includes('private database detail'), false);
  } finally {
    LoginAttempt.find = originalFind;
  }
});

test('project and member endpoints enforce roles, membership, and cascades', async () => {
  const [adminProjects, leadProjects, memberProjects, outsiderProjects] = await Promise.all([
    request(app).get('/api/projects').set(auth(adminToken)),
    request(app).get('/api/projects').set(auth(leadToken)),
    request(app).get('/api/projects').set(auth(memberToken)),
    request(app).get('/api/projects').set(auth(outsiderToken)),
  ]);
  assert.equal(adminProjects.body.length, 2);
  assert.equal(leadProjects.body.length, 2);
  assert.equal(memberProjects.body.length, 1);
  assert.deepEqual(outsiderProjects.body, []);
  assert.equal(memberProjects.body[0].members.length, 4);
  assert.deepEqual(
    memberProjects.body[0].members.map((member) => [member.id, member.projectRole]),
    [['user-lead-001', 'Owner'], ['user-member-001', 'Member'], ['user-member-002', 'Member'], ['user-viewer-001', 'Viewer']],
  );
  assert.equal(memberProjects.body[0].members[0].passwordHash, undefined);

  const forbiddenProject = await request(app).get('/api/projects/project-beta').set(auth(memberToken));
  assert.equal(forbiddenProject.status, 403);
  const missingProject = await request(app).get('/api/projects/no-such-project').set(auth(leadToken));
  assert.equal(missingProject.status, 404);

  const created = await request(app).post('/api/projects').set(auth(leadToken)).send({
    name: 'Lifecycle Project', description: 'Created by an authorized lead.',
  });
  assert.equal(created.status, 201, created.text);
  const projectId = created.body.id;
  assert.deepEqual(created.body.memberIds, ['user-lead-001']);
  const memberCreate = await request(app).post('/api/projects').set(auth(memberToken)).send({ name: 'Blocked Project' });
  assert.equal(memberCreate.status, 403);

  const updated = await request(app).patch(`/api/projects/${projectId}`).set(auth(leadToken)).send({ name: 'Updated Lifecycle' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Updated Lifecycle');

  const added = await request(app).post(`/api/projects/${projectId}/members`).set(auth(leadToken)).send({ email: 'outsider@example.test' });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.body.map((member) => member.id), ['user-lead-001', 'user-outsider-001']);
  const duplicateMember = await request(app).post(`/api/projects/${projectId}/members`).set(auth(leadToken)).send({ email: 'OUTSIDER@example.test' });
  assert.equal(duplicateMember.status, 200);
  const unknownMember = await request(app).post(`/api/projects/${projectId}/members`).set(auth(leadToken)).send({ email: 'nobody@example.test' });
  assert.equal(unknownMember.status, 404);
  assert.equal(unknownMember.body.fields.email, 'Email is not registered.');

  const ownerRemoval = await request(app).delete(`/api/projects/${projectId}/members/user-lead-001`).set(auth(leadToken));
  assert.equal(ownerRemoval.status, 400);
  const task = await request(app).post(`/api/projects/${projectId}/tasks`).set(auth(leadToken)).send({
    title: 'Cascade task', assigneeIds: ['user-outsider-001'],
  });
  assert.equal(task.status, 201, task.text);
  const removed = await request(app).delete(`/api/projects/${projectId}/members/user-outsider-001`).set(auth(leadToken));
  assert.equal(removed.status, 200);
  const unassigned = await Task.findById(task.body.id);
  assert.deepEqual(unassigned.assigneeIds, []);

  const projectTask = await Task.create({ _id: 'task-project-cascade', projectId, title: 'Delete cascade', assigneeIds: [] });
  await Comment.create({ taskId: projectTask.id, authorId: 'user-lead-001', text: 'cascade me' });
  await Notification.create({
    userId: 'user-lead-001', taskId: projectTask.id, projectId, type: 'assignment', message: 'cascade me', read: false,
  });
  const deleted = await request(app).delete(`/api/projects/${projectId}`).set(auth(leadToken));
  assert.equal(deleted.status, 204);
  assert.equal(deleted.text, '');
  assert.equal(await Project.findById(projectId), null);
  assert.equal(await Task.findOne({ projectId }), null);
  assert.equal(await Comment.findOne({ taskId: projectTask.id }), null);
  assert.equal(await Notification.findOne({ taskId: projectTask.id }), null);
});

test('TC-Task-01 creates a task through the API, persists it, and enforces validation and authorization', async (t) => {
  const response = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(leadToken))
    .send({
      title: 'TC-Task-01 persistent task creation',
      description: 'A task created through the API and stored in MongoDB.',
      dueDate: '2026-10-30',
      priority: 'High',
      status: 'To Do',
      assigneeIds: ['user-member-001'],
    });

  assert.equal(response.status, 201, response.text);
  t.after(async () => {
    await Notification.deleteMany({ taskId: response.body.id });
    await Task.deleteOne({ _id: response.body.id });
  });
  assert.deepEqual({
    title: response.body.title,
    description: response.body.description,
    dueDate: response.body.dueDate,
    priority: response.body.priority,
    status: response.body.status,
    projectId: response.body.projectId,
    assigneeIds: response.body.assigneeIds,
  }, {
    title: 'TC-Task-01 persistent task creation',
    description: 'A task created through the API and stored in MongoDB.',
    dueDate: '2026-10-30',
    priority: 'High',
    status: 'To Do',
    projectId: 'project-alpha',
    assigneeIds: ['user-member-001'],
  });

  const persisted = await Task.findById(response.body.id);
  assert.ok(persisted, 'the created task should be stored in MongoDB');
  assert.equal(persisted.title, response.body.title);

  const listed = await request(app)
    .get('/api/projects/project-alpha/tasks')
    .set(auth(memberToken));
  assert.equal(listed.status, 200, listed.text);
  assert.ok(listed.body.some((task) => task.id === response.body.id));

  const assignment = await Notification.findOne({ taskId: response.body.id, userId: 'user-member-001' });
  assert.equal(assignment?.type, 'assignment');
  assert.equal(assignment?.projectId, 'project-alpha');

  const missingTitle = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(leadToken))
    .send({ description: 'Missing title' });
  assert.equal(missingTitle.status, 400);
  assert.equal(missingTitle.body.errorCode, 'VALIDATION_ERROR');
  assert.equal(missingTitle.body.fields.title, 'Title is required.');

  const invalidDate = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(leadToken))
    .send({ title: 'Invalid date', dueDate: '2026-02-30' });
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidDate.body.errorCode, 'VALIDATION_ERROR');

  const forbidden = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(memberToken))
    .send({ title: 'Member cannot create tasks' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.errorCode, 'FORBIDDEN');
});

test('task, search, status, comment, summary, CSV, and reminder endpoints interoperate', async () => {
  const created = await request(app).post('/api/projects/project-alpha/tasks').set(auth(leadToken)).send({
    title: '=Review release export',
    description: 'Due today for the API integration test.',
    dueDate: '2026-10-16',
    assigneeIds: ['user-member-001'],
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.status, 'To Do');
  assert.equal(created.body.priority, 'Medium');
  const taskId = created.body.id;

  const invalidAssignee = await request(app).post('/api/projects/project-alpha/tasks').set(auth(leadToken)).send({
    title: 'Invalid assignment', assigneeIds: ['user-outsider-001'],
  });
  assert.equal(invalidAssignee.status, 400);
  assert.equal(invalidAssignee.body.fields.assigneeIds, 'Choose members of this project.');
  const invalidDate = await request(app).post('/api/projects/project-alpha/tasks').set(auth(leadToken)).send({
    title: 'Invalid date', dueDate: '2026-02-30',
  });
  assert.equal(invalidDate.status, 400);

  const memberTask = await request(app).get(`/api/tasks/${taskId}`).set(auth(memberToken));
  assert.equal(memberTask.status, 200);
  const status = await request(app).patch(`/api/tasks/${taskId}/status`).set(auth(memberToken)).send({ status: 'In Progress' });
  assert.equal(status.status, 200);
  assert.equal(status.body.status, 'In Progress');
  const forbiddenEdit = await request(app).patch(`/api/tasks/${taskId}`).set(auth(memberToken)).send({ title: 'forbidden' });
  assert.equal(forbiddenEdit.status, 403);
  const leadEdit = await request(app).patch(`/api/tasks/${taskId}`).set(auth(leadToken)).send({
    title: 'Updated export review', assigneeIds: ['user-member-001', 'user-member-002'],
  });
  assert.equal(leadEdit.status, 200, leadEdit.text);
  assert.deepEqual(leadEdit.body.assigneeIds, ['user-member-001', 'user-member-002']);

  const filtered = await request(app).get('/api/projects/project-alpha/tasks?q=Updated%20export&status=In%20Progress').set(auth(memberToken));
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.length, 1);
  const globalSearch = await request(app).get('/api/tasks?q=Updated%20export').set(auth(memberToken));
  assert.equal(globalSearch.status, 200);
  assert.equal(globalSearch.body[0].id, taskId);
  const badFilter = await request(app).get('/api/tasks?status=Doing').set(auth(memberToken));
  assert.equal(badFilter.status, 400);
  assert.equal(badFilter.body.errorCode, 'VALIDATION_ERROR');
  const outsiderTasks = await request(app).get('/api/tasks').set(auth(outsiderToken));
  assert.deepEqual(outsiderTasks.body, []);

  const comments = await request(app).get('/api/tasks/task-002/comments').set(auth(memberToken));
  assert.equal(comments.status, 200);
  assert.deepEqual(comments.body.map((item) => item.id), ['comment-001', 'comment-002']);
  assert.equal(comments.body[0].author.id, 'user-lead-001');
  const xss = "<script>alert('x')</script>";
  const comment = await request(app).post(`/api/tasks/${taskId}/comments`).set(auth(memberToken)).send({ text: xss });
  assert.equal(comment.status, 201, comment.text);
  assert.equal(comment.body.text, xss);
  assert.equal(comment.body.author.id, 'user-member-001');
  const blankComment = await request(app).post(`/api/tasks/${taskId}/comments`).set(auth(memberToken)).send({ text: '   ' });
  assert.equal(blankComment.status, 400);
  const outsiderComment = await request(app).get(`/api/tasks/${taskId}/comments`).set(auth(outsiderToken));
  assert.equal(outsiderComment.status, 403);
  const memberCannotDeleteAnotherAuthorsComment = await request(app)
    .delete('/api/tasks/task-002/comments/comment-001')
    .set(auth(memberToken));
  assert.equal(memberCannotDeleteAnotherAuthorsComment.status, 403);
  const commentOnWrongTask = await request(app)
    .delete(`/api/tasks/task-002/comments/${comment.body.id}`)
    .set(auth(memberToken));
  assert.equal(commentOnWrongTask.status, 404);
  const missingComment = await request(app)
    .delete(`/api/tasks/${taskId}/comments/comment-missing-001`)
    .set(auth(memberToken));
  assert.equal(missingComment.status, 404);
  const ownCommentDeleted = await request(app)
    .delete(`/api/tasks/${taskId}/comments/${comment.body.id}`)
    .set(auth(memberToken));
  assert.equal(ownCommentDeleted.status, 204);
  assert.equal(await Comment.findById(comment.body.id), null);
  const leadDeletesComment = await request(app)
    .delete('/api/tasks/task-002/comments/comment-001')
    .set(auth(leadToken));
  assert.equal(leadDeletesComment.status, 204);
  assert.equal(await Comment.findById('comment-001'), null);

  const summary = await request(app).get('/api/projects/project-alpha/summary').set(auth(memberToken));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.projectId, 'project-alpha');
  assert.equal(summary.body.total, 8);
  assert.equal(summary.body.overdue, 1);
  const csv = await request(app).get('/api/projects/project-alpha/tasks/export.csv').set(auth(memberToken));
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv; charset=utf-8/);
  assert.match(csv.text, /'=HYPERLINK/);
  assert.match(csv.text, /\r\n/);

  const memberNotifications = await request(app).get('/api/notifications?page=1&pageSize=100').set(auth(memberToken));
  assert.equal(memberNotifications.status, 200);
  assert.equal(memberNotifications.body.page, 1);
  assert.equal(memberNotifications.body.pageSize, 100);
  assert.ok(memberNotifications.body.items.some((item) => item.taskId === taskId && item.type === 'assignment'));
  assert.ok(memberNotifications.body.items.some((item) => item.taskId === taskId && item.type === 'due-date'));
  assert.ok(memberNotifications.body.items.every((item) => item.userId === 'user-member-001'));
  const secondMemberNotifications = await request(app).get('/api/notifications').set(auth(secondMemberToken));
  assert.ok(secondMemberNotifications.body.items.some((item) => item.taskId === taskId && item.type === 'assignment'));
  const read = await request(app).patch('/api/notifications/notif-002/read').set(auth(memberToken));
  assert.equal(read.status, 200);
  assert.equal(read.body.read, true);
  const otherUserNotification = await request(app).patch('/api/notifications/notif-004/read').set(auth(memberToken));
  assert.equal(otherUserNotification.status, 404);
  const badPage = await request(app).get('/api/notifications?page=0').set(auth(memberToken));
  assert.equal(badPage.status, 400);

  const deleted = await request(app).delete(`/api/tasks/${taskId}`).set(auth(leadToken));
  assert.equal(deleted.status, 204);
  assert.equal(await Comment.findOne({ taskId }), null);
  assert.equal(await Notification.findOne({ taskId }), null);
});

test('TC-Task-02 edits task fields, persists changes, and enforces manager authorization', async (t) => {
  const created = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(leadToken))
    .send({ title: 'TC-Task-02 editable task', description: 'Before edit.' });
  assert.equal(created.status, 201, created.text);
  const taskId = created.body.id;
  t.after(async () => {
    await Notification.deleteMany({ taskId });
    await Task.deleteOne({ _id: taskId });
  });

  const invalidTitle = await request(app)
    .patch(`/api/tasks/${taskId}`)
    .set(auth(leadToken))
    .send({ title: '   ' });
  assert.equal(invalidTitle.status, 400);
  assert.equal(invalidTitle.body.errorCode, 'VALIDATION_ERROR');
  assert.equal(invalidTitle.body.fields.title, 'Title is required.');

  const invalidDate = await request(app)
    .patch(`/api/tasks/${taskId}`)
    .set(auth(leadToken))
    .send({ dueDate: '2026-02-30' });
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidDate.body.errorCode, 'VALIDATION_ERROR');

  const memberEdit = await request(app)
    .patch(`/api/tasks/${taskId}`)
    .set(auth(memberToken))
    .send({ title: 'Member cannot edit task fields.' });
  assert.equal(memberEdit.status, 403);
  assert.equal(memberEdit.body.errorCode, 'FORBIDDEN');

  const outsiderEdit = await request(app)
    .patch(`/api/tasks/${taskId}`)
    .set(auth(outsiderToken))
    .send({ title: 'Outsider cannot edit task fields.' });
  assert.equal(outsiderEdit.status, 403);

  const edited = await request(app)
    .patch(`/api/tasks/${taskId}`)
    .set(auth(leadToken))
    .send({
      title: 'TC-Task-02 edited task',
      description: 'After edit.',
      dueDate: '2026-11-15',
      priority: 'High',
      assigneeIds: ['user-member-001'],
    });
  assert.equal(edited.status, 200, edited.text);
  assert.deepEqual({
    title: edited.body.title,
    description: edited.body.description,
    dueDate: edited.body.dueDate,
    priority: edited.body.priority,
    status: edited.body.status,
    assigneeIds: edited.body.assigneeIds,
  }, {
    title: 'TC-Task-02 edited task',
    description: 'After edit.',
    dueDate: '2026-11-15',
    priority: 'High',
    status: 'To Do',
    assigneeIds: ['user-member-001'],
  });

  const persisted = await request(app).get(`/api/tasks/${taskId}`).set(auth(memberToken));
  assert.equal(persisted.status, 200, persisted.text);
  assert.equal(persisted.body.title, 'TC-Task-02 edited task');
  assert.equal(persisted.body.description, 'After edit.');
});

test('TC-Task-03 updates status for project members and rejects invalid or unauthorized changes', async (t) => {
  const created = await request(app)
    .post('/api/projects/project-alpha/tasks')
    .set(auth(leadToken))
    .send({ title: 'TC-Task-03 status task' });
  assert.equal(created.status, 201, created.text);
  const taskId = created.body.id;
  t.after(async () => {
    await Notification.deleteMany({ taskId });
    await Task.deleteOne({ _id: taskId });
  });

  const unauthenticated = await request(app).patch(`/api/tasks/${taskId}/status`).send({ status: 'In Progress' });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.errorCode, 'UNAUTHENTICATED');

  const invalid = await request(app)
    .patch(`/api/tasks/${taskId}/status`)
    .set(auth(memberToken))
    .send({ status: 'Doing' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errorCode, 'VALIDATION_ERROR');
  assert.equal(invalid.body.fields.status, 'Choose To Do, In Progress, Done.');

  const outsider = await request(app)
    .patch(`/api/tasks/${taskId}/status`)
    .set(auth(outsiderToken))
    .send({ status: 'In Progress' });
  assert.equal(outsider.status, 403);
  assert.equal(outsider.body.errorCode, 'FORBIDDEN');

  const updated = await request(app)
    .patch(`/api/tasks/${taskId}/status`)
    .set(auth(memberToken))
    .send({ status: 'In Progress' });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.body.taskId, taskId);
  assert.equal(updated.body.status, 'In Progress');

  const persisted = await request(app).get(`/api/tasks/${taskId}`).set(auth(leadToken));
  assert.equal(persisted.status, 200, persisted.text);
  assert.equal(persisted.body.status, 'In Progress');
});

test('admin writes are audit-logged without request secrets or bodies', async () => {
  logRecords.length = 0;
  const response = await request(app)
    .patch('/api/projects/project-alpha')
    .set(auth(adminToken))
    .send({ description: 'Admin updated this project.', password: 'never-log-this', token: 'also-never-log-this' });
  assert.equal(response.status, 200, response.text);
  const record = logRecords.find((item) => item.audit === true);
  assert.ok(record);
  assert.equal(record.actorId, 'user-admin-001');
  assert.equal(record.role, 'Admin');
  assert.equal(record.method, 'PATCH');
  assert.equal(record.route, '/api/projects/:projectId');
  assert.deepEqual(record.targetIds, { projectId: 'project-alpha' });
  assert.equal(record.status, 200);
  assert.doesNotMatch(JSON.stringify(record), /never-log-this|also-never-log-this|password|token/);
});

test('reading notifications creates due reminders only for the caller (TM-F-031)', async () => {
  const task = await Task.create({
    title: 'Reminder scope check',
    projectId: 'project-beta',
    assigneeIds: ['user-admin-001'],
    dueDate: '2026-10-16',
  });
  try {
    const memberRead = await request(app).get('/api/notifications').set('Authorization', `Bearer ${memberToken}`);
    assert.equal(memberRead.status, 200);
    assert.equal(await Notification.countDocuments({ taskId: task.id, type: 'due-date' }), 0);

    const adminReads = await Promise.all(Array.from({ length: 5 }, () => (
      request(app).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`)
    )));
    assert.deepEqual(adminReads.map((response) => response.status), [200, 200, 200, 200, 200]);
    assert.equal(await Notification.countDocuments({ taskId: task.id, userId: 'user-admin-001', type: 'due-date' }), 1);
  } finally {
    await Notification.deleteMany({ taskId: task.id });
    await task.deleteOne();
  }
});

test('login takes comparable time for unknown emails and wrong passwords (no account enumeration)', async () => {
  const timeLogin = async (email) => {
    const started = performance.now();
    const response = await request(app).post('/api/auth/login').send({ email, password: 'Wrong-password-1' });
    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, 'INVALID_CREDENTIALS');
    return performance.now() - started;
  };
  const unknownMs = await timeLogin('nobody.registered@example.test');
  const knownMs = await timeLogin('outsider@example.test');
  assert.ok(unknownMs > knownMs * 0.5, `unknown email ${unknownMs.toFixed(0)} ms vs wrong password ${knownMs.toFixed(0)} ms`);
});

test('local today controls dashboard stats and project summary and rejects invalid dates', async () => {
  const localApp = createApp({ jwtSecret: JWT_SECRET, now: () => new Date('2026-10-15T19:00:00.000Z'), logger: () => {} });
  const task = await Task.create({ title: 'Local date boundary', projectId: 'project-alpha', status: 'To Do', priority: 'Medium', dueDate: '2026-10-15', assigneeIds: ['user-member-001'] });
  try {
    const get = (path) => request(localApp).get(path).set(auth(memberToken));
    const [local, utc, summary, invalid] = await Promise.all([get('/api/dashboard?today=2026-10-16'), get('/api/dashboard'), get('/api/projects/project-alpha/summary?today=2026-10-16'), get('/api/dashboard?today=2026-10-20')]);
    assert.equal(local.body.stats.overdue, utc.body.stats.overdue + 1);
    assert.equal(local.body.projects[0].overdue, summary.body.overdue);
    assert.equal(invalid.body.stats.overdue, utc.body.stats.overdue);
  } finally { await Task.deleteOne({ _id: task.id }); }
});

test('dashboard caps open tasks after dated tasks but stats count all assignments', async () => {
  const tasks = Array.from({ length: 501 }, (_, i) => ({ title: `Undated ${i}`, projectId: 'project-alpha', status: 'To Do', priority: 'Medium', assigneeIds: ['user-outsider-001'] }));
  tasks.push({ title: 'Dated task', projectId: 'project-alpha', status: 'To Do', priority: 'Medium', dueDate: '2026-10-15', assigneeIds: ['user-outsider-001'] });
  const inserted = await Task.insertMany(tasks);
  try {
    const response = await request(app).get('/api/dashboard').set(auth(adminToken));
    assert.equal(response.status, 200);
    const dated = response.body.myTasks.find((task) => task.title === 'Dated task');
    assert.equal(dated, undefined); // assigned to another user
    const { getDashboardData } = await import('../services/task-aggregates.js');
    const data = await getDashboardData(['project-alpha'], 'user-outsider-001', () => FIXED_NOW);
    assert.equal(data.myTasks.length, 500);
    assert.equal(data.myTasks[0].title, 'Dated task');
    assert.equal(data.stats.openAssigned, 502);
    assert.equal(data.stats.overdue, 1);
  } finally { await Task.deleteMany({ _id: { $in: inserted.map((task) => task.id) } }); }
});

test('unread count generates reminders once and retries a failed scan', async () => {
  await Notification.deleteMany({ userId: 'user-outsider-001' });
  await User.updateOne({ _id: 'user-outsider-001' }, { $set: { lastReminderScanAt: null } });
  const task = await Task.create({ title: 'Badge reminder', projectId: 'project-alpha', status: 'To Do', priority: 'Medium', dueDate: '2026-10-16', assigneeIds: ['user-outsider-001'] });
  const originalFind = Task.find;
  try {
    let scans = 0;
    Task.find = function (...args) { scans++; if (scans === 1) throw new Error('scan failed'); return originalFind.apply(this, args); };
    assert.equal((await request(app).get('/api/notifications/unread-count').set(auth(outsiderToken))).status, 500);
    assert.equal((await User.findById('user-outsider-001')).lastReminderScanAt, null);
    const count = await request(app).get('/api/notifications/unread-count').set(auth(outsiderToken));
    assert.equal(count.body.unreadCount, 1);
    assert.equal((await request(app).get('/api/notifications/unread-count').set(auth(outsiderToken))).body.unreadCount, 1);
    assert.equal(scans, 2);
  } finally { Task.find = originalFind; await Notification.deleteMany({ taskId: task.id }); await Task.deleteOne({ _id: task.id }); }
});

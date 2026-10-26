import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { Comment, Notification, Project, Task, User } from '../src/models/index.js';
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
    const response = await request(app).post('/api/auth/login').send({
      email: 'rate-limit@example.test', password: 'WrongPassword123',
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, 'INVALID_CREDENTIALS');
  }
  const throttled = await request(app).post('/api/auth/login').send({
    email: 'rate-limit@example.test', password: 'WrongPassword123',
  });
  assert.equal(throttled.status, 429);
  assert.equal(throttled.body.errorCode, 'RATE_LIMITED');
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
  assert.equal(memberProjects.body[0].members.length, 3);
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

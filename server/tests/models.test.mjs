import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginAttempt, Task, User } from '../models/index.js';

test('model JSON uses string id and never exposes Mongo internals or password hashes', () => {
  const model = new User({
    _id: 'user-member-001',
    name: 'Synthetic Member',
    email: 'member@example.test',
    emailNormalized: 'member@example.test',
    passwordHash: 'a-secret-hash',
    role: 'Member',
  });
  const user = model.toJSON();

  assert.equal(model.id, 'user-member-001');
  assert.equal(user.id, 'user-member-001');
  assert.equal(user._id, undefined);
  assert.equal(user.__v, undefined);
  assert.equal(user.passwordHash, undefined);
});

test('task JSON preserves date-only values and normalizes an absent due date to null', () => {
  const dueTask = new Task({
    _id: 'task-due', title: 'Due task', projectId: 'project-alpha', dueDate: '2026-10-17',
  }).toJSON();
  const noDueDateTask = new Task({
    _id: 'task-no-due', title: 'No due date', projectId: 'project-alpha',
  }).toJSON();

  assert.equal(dueTask.dueDate, '2026-10-17');
  assert.equal(noDueDateTask.dueDate, null);
});

test('login attempt records expire automatically and retain only a keyed digest', () => {
  const key = 'a'.repeat(64);
  const attempt = new LoginAttempt({
    _id: key,
    attempts: 1,
    windowStartedAt: new Date('2026-10-16T12:00:00.000Z'),
    expiresAt: new Date('2026-10-16T12:01:00.000Z'),
  }).toJSON();
  const ttlIndex = LoginAttempt.schema.indexes().find(([fields]) => fields.expiresAt === 1);

  assert.equal(attempt.id, key);
  assert.equal(JSON.stringify(attempt).includes('@example'), false);
  assert.equal(JSON.stringify(attempt).includes('198.51.100'), false);
  assert.deepEqual(ttlIndex, [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]);
});

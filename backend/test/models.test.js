import assert from 'node:assert/strict';
import test from 'node:test';
import { Task, User } from '../src/models/index.js';

test('model JSON uses string id and never exposes Mongo internals or password hashes', () => {
  const user = new User({
    _id: 'user-member-001',
    name: 'Synthetic Member',
    email: 'member@example.test',
    emailNormalized: 'member@example.test',
    passwordHash: 'a-secret-hash',
    role: 'Member',
  }).toJSON();

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

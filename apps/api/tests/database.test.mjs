import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { FIXTURE_PASSWORD } from '../src/utils/seed-database.js';
import { Comment, Notification, Project, Task, User } from '../src/models/index.js';
import { startTestDatabase } from '../test-support/database.mjs';

let database;

before(async () => {
  database = await startTestDatabase();
});

after(async () => {
  await database?.stop();
});

test('fixture helper seeds a fresh in-memory database with synthetic entities', async () => {
  assert.equal(await User.countDocuments(), 5);
  assert.equal(await Project.countDocuments(), 2);
  assert.equal(await Task.countDocuments(), 10);
  assert.equal(await Comment.countDocuments(), 4);
  assert.equal(await Notification.countDocuments(), 5);
  assert.equal(mongoose.connection.name, 'task_manager_test');
});

test('fixture password is bcrypt hashed and safe model JSON omits it', async () => {
  const user = await User.findOne({ emailNormalized: 'member@example.test' }).select('+passwordHash');
  assert.ok(await bcrypt.compare(FIXTURE_PASSWORD, user.passwordHash));
  assert.equal(user.toJSON().passwordHash, undefined);
});

test('seeded notifications include their project ids and reminder deduplication keys', async () => {
  const reminder = await Notification.findOne({ type: 'due-date' });
  assert.equal(reminder.projectId, 'project-alpha');
  assert.equal(reminder.dedupeKey, 'task-004:2026-10-17');
});

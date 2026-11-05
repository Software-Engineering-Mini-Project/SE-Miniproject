import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedRefusalReason } from '../../scripts/seed-guard.js';
import { daysSinceFixtureAnchor, FIXTURE_ANCHOR_DATE } from '../utils/seed-database.js';

test('the destructive seed only runs against local databases unless explicitly allowed', () => {
  for (const uri of [
    'mongodb://127.0.0.1:27017/task_manager_dev',
    'mongodb://localhost/task_manager_e2e',
    'mongodb://user:pass@localhost:27017,127.0.0.1:27018/rs?replicaSet=rs0',
    'mongodb://mongo:27017/ci',
  ]) assert.equal(seedRefusalReason(uri, {}), null, uri);

  assert.match(seedRefusalReason('mongodb+srv://u:p@cluster0.example.mongodb.net/app', {}), /mongodb\+srv/);
  assert.match(seedRefusalReason('mongodb://db.example.com:27017/app', {}), /db\.example\.com/);
  assert.match(seedRefusalReason('mongodb://localhost:27017,db.example.com/app', {}), /db\.example\.com/);
  assert.match(seedRefusalReason('mongodb://localhost/app', { nodeEnv: 'production' }), /production/);
  assert.equal(seedRefusalReason('mongodb+srv://u:p@cluster0.example.mongodb.net/app', { allow: true }), null);
});

test('demo dates shift the fixtures by whole days from their anchor', () => {
  assert.equal(daysSinceFixtureAnchor(FIXTURE_ANCHOR_DATE), 0);
  assert.equal(daysSinceFixtureAnchor('2026-11-06'), 23);
  assert.equal(daysSinceFixtureAnchor('2026-10-01'), -13);
});

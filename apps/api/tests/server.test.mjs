import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from '../src/server.js';

const environment = {
  mongoUri: 'mongodb://user:password@db.example.test/task_manager',
  port: 4000,
};

test('server connects before listening and logs only the configured port', async () => {
  const calls = [];
  const records = [];
  const expectedServer = { listening: true };
  const server = await startServer({
    environment,
    connect: async (uri, options) => calls.push(['connect', uri, options]),
    listen: (port, callback) => {
      calls.push(['listen', port]);
      callback();
      return expectedServer;
    },
    logger: { info: (record) => records.push(record) },
  });

  assert.equal(server, expectedServer);
  assert.deepEqual(calls, [
    ['connect', environment.mongoUri, { serverSelectionTimeoutMS: 5000 }],
    ['listen', environment.port],
  ]);
  assert.deepEqual(records, [JSON.stringify({ event: 'api_listening', port: 4000 })]);
  assert.doesNotMatch(JSON.stringify(records), /password|db\.example/);
});

test('failed MongoDB connection prevents listening and never logs the error or URI', async () => {
  const listenCalls = [];
  const records = [];
  const server = await startServer({
    environment,
    connect: async () => { throw new Error(`failed to connect ${environment.mongoUri}`); },
    listen: (...args) => listenCalls.push(args),
    logger: { error: (record) => records.push(record) },
  });

  assert.equal(server, null);
  assert.deepEqual(listenCalls, []);
  assert.deepEqual(records, [JSON.stringify({ event: 'database_connection_failed' })]);
  assert.doesNotMatch(JSON.stringify(records), /password|db\.example|failed to connect/);
});

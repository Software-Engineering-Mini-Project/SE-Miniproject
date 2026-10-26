import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

const fixedDate = new Date('2026-10-26T12:00:00.000Z');

function captureApp(extendRoutes) {
  const records = [];
  const app = createApp({
    logger: (record) => records.push(record),
    now: () => fixedDate,
    extendRoutes,
  });
  return { app, records };
}

test('health endpoint returns a predictable JSON success response without Express branding', async () => {
  const { app } = captureApp();
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.ok(response.headers['x-request-id']);
  assert.ok(response.headers['x-content-type-options']);
});

test('unknown routes return the common JSON 404 envelope', async () => {
  const { app } = captureApp();
  const response = await request(app).get('/api/not-a-route');
  assert.equal(response.status, 404);
  assert.equal(response.headers['content-type'].includes('application/json'), true);
  assert.deepEqual(response.body, {
    errorCode: 'NOT_FOUND',
    message: 'Route not found.',
    timestamp: fixedDate.toISOString(),
  });
});

test('malformed JSON returns a validation envelope without stack or file paths', async () => {
  const { app, records } = captureApp();
  const response = await request(app)
    .post('/api/health')
    .set('Content-Type', 'application/json')
    .send('{');
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'VALIDATION_ERROR');
  assert.equal(response.body.timestamp, fixedDate.toISOString());
  assert.doesNotMatch(JSON.stringify(response.body), /stack|backend[\\/]src|node_modules/i);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 400);
  assert.equal(records[0].errorCode, 'VALIDATION_ERROR');
});

test('oversized JSON is rejected with an error envelope', async () => {
  const { app } = captureApp();
  const response = await request(app)
    .post('/api/health')
    .send({ text: 'x'.repeat(101 * 1024) });
  assert.equal(response.status, 413);
  assert.equal(response.body.errorCode, 'VALIDATION_ERROR');
  assert.equal(response.body.message, 'Request body is too large.');
});

test('unexpected errors return a generic 500 and logs omit the request body and query string', async () => {
  const { app, records } = captureApp((router) => {
    router.post('/api/__test/failure', () => {
      throw new Error('sensitive database path and connection details');
    });
  });
  const response = await request(app)
    .post('/api/__test/failure?access_token=do-not-log')
    .send({ password: 'do-not-log', token: 'do-not-log' });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    errorCode: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    timestamp: fixedDate.toISOString(),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].route, '/api/__test/failure');
  assert.equal(records[0].status, 500);
  assert.ok(records[0].requestId);
  assert.equal(records[0].userId, null);
  assert.equal(records[0].errorCode, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(records), /sensitive database|connection details|do-not-log|access_token/);
});

test('request logging honors a safe caller request id and records route, status, and user id', async () => {
  const { app, records } = captureApp();
  const response = await request(app).get('/api/health').set('X-Request-Id', 'qa-run:phase0');
  assert.equal(response.headers['x-request-id'], 'qa-run:phase0');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    event: 'http_request',
    timestamp: fixedDate.toISOString(),
    requestId: 'qa-run:phase0',
    method: 'GET',
    route: '/api/health',
    status: 200,
    userId: null,
  });
});

test('CORS allows the configured frontend and omits allow-origin for other origins', async () => {
  const { app } = captureApp();
  const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
  const denied = await request(app).get('/api/health').set('Origin', 'https://untrusted.example');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('preflight exposes only the agreed methods and headers', async () => {
  const { app } = captureApp();
  const response = await request(app)
    .options('/api/health')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'PATCH')
    .set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(response.status, 204);
  assert.match(response.headers['access-control-allow-methods'], /GET,POST,PATCH,DELETE/);
  assert.match(response.headers['access-control-allow-headers'], /Authorization,Content-Type/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

test('invalid configuration returns a JSON 503 response', async () => {
  process.env.MONGODB_URI = '';
  const { default: app } = await import('../index.js');
  const result = await request(app).get('/api/health');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { errorCode: 'CONFIGURATION_ERROR', message: 'Server is not configured.' });
});

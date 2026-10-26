import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError, parseEnvironment } from '../src/config/env.js';

const validEnvironment = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/task_manager',
  JWT_SECRET: 'a-test-secret-that-is-long-enough-to-pass-validation',
};

test('environment defaults match the agreed API configuration', () => {
  const environment = parseEnvironment(validEnvironment);
  assert.equal(environment.port, 4000);
  assert.equal(environment.jwtExpiresIn, 7200);
  assert.deepEqual(environment.corsOrigins, ['http://localhost:3000']);
  assert.equal(environment.mongoUri, validEnvironment.MONGODB_URI);
});

test('environment accepts a comma-separated allowlist of frontend origins', () => {
  const environment = parseEnvironment({
    ...validEnvironment,
    CORS_ORIGIN: 'http://localhost:3000,https://tasks.example.test',
  });
  assert.deepEqual(environment.corsOrigins, ['http://localhost:3000', 'https://tasks.example.test']);
});

test('environment rejects missing MongoDB URI without exposing a value', () => {
  assert.throws(
    () => parseEnvironment({ JWT_SECRET: validEnvironment.JWT_SECRET }),
    (error) => error instanceof ConfigurationError && error.variable === 'MONGODB_URI',
  );
});

test('environment rejects weak JWT secrets and out-of-range values', () => {
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, JWT_SECRET: 'short' }),
    (error) => error instanceof ConfigurationError && error.variable === 'JWT_SECRET',
  );
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, PORT: '70000' }),
    (error) => error instanceof ConfigurationError && error.variable === 'PORT',
  );
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, JWT_EXPIRES_IN: '0' }),
    (error) => error instanceof ConfigurationError && error.variable === 'JWT_EXPIRES_IN',
  );
});

test('environment rejects CORS values that are not origins', () => {
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, CORS_ORIGIN: 'https://example.test/path' }),
    (error) => error instanceof ConfigurationError && error.variable === 'CORS_ORIGIN',
  );
});

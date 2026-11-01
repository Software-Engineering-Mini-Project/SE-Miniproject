import assert from 'node:assert/strict';
import test from 'node:test';
import { deployStaging } from './deploy-staging.mjs';

const COMMIT = 'a'.repeat(40);
const environment = {
  STAGING_DEPLOY_ENABLED: 'true',
  RENDER_API_DEPLOY_HOOK_URL: 'https://api.render.com/deploy/srv-api?key=api-secret',
  RENDER_WEB_DEPLOY_HOOK_URL: 'https://api.render.com/deploy/srv-web?key=web-secret',
  STAGING_API_URL: 'https://task-manager-api-staging.onrender.com',
  STAGING_WEB_URL: 'https://task-manager-web-staging.onrender.com',
  GITHUB_SHA: COMMIT,
};

const quietLogger = { info() {} };

test('deploys both services at the tested SHA and verifies both health endpoints', async () => {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });

    if (url.hostname === 'api.render.com') return new Response('', { status: 202 });
    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' }, { status: 200 });
    }
    if (url.pathname === '/login') return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  };

  await deployStaging({ env: environment, fetchImpl, logger: quietLogger });

  const deployCalls = calls.filter(({ url }) => url.hostname === 'api.render.com');
  assert.equal(deployCalls.length, 2);
  assert.ok(deployCalls.every(({ options }) => options.method === 'POST'));
  assert.ok(deployCalls.every(({ url }) => url.searchParams.get('ref') === COMMIT));
  assert.deepEqual(
    calls.filter(({ url }) => url.hostname.endsWith('.onrender.com')).map(({ url }) => url.pathname).sort(),
    ['/api/health', '/login'],
  );
});

test('requires enabled staging and all provider settings before making network calls', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return new Response('', { status: 200 });
  };

  await assert.rejects(
    deployStaging({ env: { ...environment, STAGING_DEPLOY_ENABLED: 'false' }, fetchImpl, logger: quietLogger }),
    /Staging deployment is disabled/,
  );
  await assert.rejects(
    deployStaging({ env: { ...environment, RENDER_API_DEPLOY_HOOK_URL: '' }, fetchImpl, logger: quietLogger }),
    /RENDER_API_DEPLOY_HOOK_URL/,
  );
  assert.equal(requestCount, 0);
});

test('rejects non-Render deploy hooks and non-Render service URLs before making requests', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return new Response('', { status: 200 });
  };

  await assert.rejects(
    deployStaging({
      env: { ...environment, RENDER_WEB_DEPLOY_HOOK_URL: 'https://attacker.example/deploy/hook' },
      fetchImpl,
      logger: quietLogger,
    }),
    /RENDER_WEB_DEPLOY_HOOK_URL must be a Render deploy hook URL/,
  );
  await assert.rejects(
    deployStaging({ env: { ...environment, STAGING_API_URL: 'https://localhost' }, fetchImpl, logger: quietLogger }),
    /STAGING_API_URL must be an assigned Render HTTPS origin/,
  );
  assert.equal(requestCount, 0);
});

test('retries an API health failure and succeeds when the deployed service becomes ready', async () => {
  let healthAttempts = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.render.com') return new Response('', { status: 202 });
    if (url.pathname === '/api/health') {
      healthAttempts += 1;
      return healthAttempts === 1
        ? new Response('', { status: 503 })
        : Response.json({ status: 'ok' }, { status: 200 });
    }
    return new Response('', { status: 200 });
  };

  await deployStaging({
    env: environment,
    fetchImpl,
    logger: quietLogger,
    maxAttempts: 2,
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(healthAttempts, 2);
});

test('fails the deployment when an API health check never passes', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.render.com') return new Response('', { status: 202 });
    if (url.pathname === '/api/health') return new Response('', { status: 503 });
    return new Response('', { status: 200 });
  };

  await assert.rejects(
    deployStaging({
      env: environment,
      fetchImpl,
      logger: quietLogger,
      maxAttempts: 2,
      intervalMs: 0,
      sleep: async () => {},
    }),
    /API staging health check did not pass after 2 attempts/,
  );
});

test('does not run health checks if Render rejects a deployment hook request', async () => {
  let healthCount = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.render.com') return new Response('', { status: 403 });
    healthCount += 1;
    return new Response('', { status: 200 });
  };

  await assert.rejects(
    deployStaging({ env: environment, fetchImpl, logger: quietLogger }),
    /Render rejected the API staging deployment request/,
  );
  assert.equal(healthCount, 0);
});

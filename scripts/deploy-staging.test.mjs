import assert from 'node:assert/strict';
import test from 'node:test';
import { deployStaging } from './deploy-staging.mjs';

const COMMIT = 'a'.repeat(40);
const environment = {
  STAGING_DEPLOY_ENABLED: 'true',
  RENDER_API_DEPLOY_HOOK_URL: 'https://api.render.com/deploy/srv-api?key=api-secret',
  RENDER_WEB_DEPLOY_HOOK_URL: 'https://api.render.com/deploy/srv-web?key=web-secret',
  RENDER_API_TOKEN: 'render-api-token',
  STAGING_API_URL: 'https://task-manager-api-staging.onrender.com',
  STAGING_WEB_URL: 'https://task-manager-web-staging.onrender.com',
  GITHUB_SHA: COMMIT,
};

const quietLogger = { info() {} };

function deployment(id, status = 'live', commitId = COMMIT) {
  return {
    id,
    status,
    commit: { id: commitId },
    createdAt: new Date(Date.now()).toISOString(),
  };
}

test('waits for the exact API and web deployments to become live before health checks', async () => {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });

    if (url.pathname.startsWith('/deploy/')) {
      return Response.json({ id: `deploy-${url.pathname.endsWith('srv-api') ? 'api' : 'web'}` });
    }
    if (url.pathname.includes('/deploys/deploy-')) {
      const service = url.pathname.endsWith('deploy-api') ? 'api' : 'web';
      return Response.json(deployment(`deploy-${service}`));
    }
    if (url.pathname === '/api/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/login') return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  };

  await deployStaging({ env: environment, fetchImpl, logger: quietLogger });

  const hookCalls = calls.filter(({ url }) => url.pathname.startsWith('/deploy/'));
  assert.equal(hookCalls.length, 2);
  assert.ok(hookCalls.every(({ options }) => options.method === 'POST'));
  assert.ok(hookCalls.every(({ url }) => url.searchParams.get('ref') === COMMIT));
  const statusCalls = calls.filter(({ url }) => url.pathname.includes('/deploys/deploy-'));
  assert.equal(statusCalls.length, 2);
  assert.ok(statusCalls.every(({ options }) => options.headers.Authorization === 'Bearer render-api-token'));
  const firstHealthCheck = calls.findIndex(({ url }) => url.pathname === '/api/health' || url.pathname === '/login');
  const lastDeployStatus = calls.reduce((last, { url }, index) => (
    url.pathname.includes('/deploys/deploy-') ? index : last
  ), -1);
  assert.ok(firstHealthCheck > lastDeployStatus);
});

test('discovers and waits for a queued deploy when the hook returns 202', async () => {
  const calls = [];
  let apiChecks = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.startsWith('/deploy/')) {
      return url.pathname.endsWith('srv-api')
        ? new Response('', { status: 202 })
        : Response.json({ id: 'deploy-web' });
    }
    if (url.pathname.endsWith('/services/srv-api/deploys')) {
      apiChecks += 1;
      const status = apiChecks === 1 ? 'queued' : 'live';
      return Response.json([{ deploy: deployment('deploy-api', status) }]);
    }
    if (url.pathname.includes('/deploys/deploy-web')) return Response.json(deployment('deploy-web'));
    if (url.pathname === '/api/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/login') return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  };

  await deployStaging({
    env: environment,
    fetchImpl,
    logger: quietLogger,
    maxAttempts: 3,
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(apiChecks, 2);
  assert.equal(calls.filter((url) => url.pathname.endsWith('/services/srv-api/deploys')).length, 2);
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
    deployStaging({ env: { ...environment, RENDER_API_TOKEN: '' }, fetchImpl, logger: quietLogger }),
    /RENDER_API_TOKEN/,
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

test('retries deployment status until the requested commit is live, then retries health', async () => {
  const deploymentAttempts = { api: 0, web: 0 };
  let healthAttempts = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: `id-${url.pathname.endsWith('srv-api') ? 'api' : 'web'}` });
    if (url.pathname.includes('/deploys/id-')) {
      const service = url.pathname.endsWith('id-api') ? 'api' : 'web';
      deploymentAttempts[service] += 1;
      return Response.json(deployment(
        'id',
        deploymentAttempts[service] <= 2 ? 'build_in_progress' : 'live',
      ));
    }
    if (url.pathname === '/api/health') {
      healthAttempts += 1;
      return healthAttempts === 1
        ? new Response('', { status: 503 })
        : Response.json({ status: 'ok' });
    }
    return new Response('', { status: 200 });
  };

  await deployStaging({
    env: environment,
    fetchImpl,
    logger: quietLogger,
    maxAttempts: 3,
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.deepEqual(deploymentAttempts, { api: 3, web: 3 });
  assert.equal(healthAttempts, 2);
});

test('fails when Render reports a terminal deployment failure', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: 'deploy-id' });
    if (url.pathname.includes('/deploys/deploy-id')) {
      return Response.json(deployment('deploy-id', 'build_failed'));
    }
    throw new Error('Health checks must not run after deployment failure.');
  };

  await assert.rejects(
    deployStaging({ env: environment, fetchImpl, logger: quietLogger, maxAttempts: 1 }),
    /API Render deployment failed \(build_failed\)/,
  );
});

test('fails when Render reports a deployment for a different commit', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: 'deploy-id' });
    if (url.pathname.includes('/deploys/deploy-id')) {
      return Response.json(deployment('deploy-id', 'live', 'b'.repeat(40)));
    }
    throw new Error('Health checks must not run for the wrong commit.');
  };

  await assert.rejects(
    deployStaging({ env: environment, fetchImpl, logger: quietLogger, maxAttempts: 1 }),
    /API Render deployment does not match the tested commit/,
  );
});

test('fails when a deployment never becomes live', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: 'deploy-id' });
    if (url.pathname.includes('/deploys/deploy-id')) {
      return Response.json(deployment('deploy-id', 'build_in_progress'));
    }
    throw new Error('Health checks must not run before deployment is live.');
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
    /API Render deployment did not become live after 2 attempts/,
  );
});

test('does not run health checks if Render rejects a deployment hook request', async () => {
  let healthCount = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return new Response('', { status: 403 });
    healthCount += 1;
    return new Response('', { status: 200 });
  };

  await assert.rejects(
    deployStaging({ env: environment, fetchImpl, logger: quietLogger }),
    /Render rejected the API staging deployment request/,
  );
  assert.equal(healthCount, 0);
});

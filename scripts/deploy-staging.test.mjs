import assert from 'node:assert/strict';
import test from 'node:test';
import { deployStaging } from './deploy-staging.mjs';

const sha = 'a'.repeat(40);
const env = { STAGING_DEPLOY_ENABLED: 'true', RENDER_DEPLOY_HOOK_URL: 'https://api.render.com/deploy/srv-test?key=secret', RENDER_API_TOKEN: 'token', STAGING_URL: 'https://staging.example', GITHUB_SHA: sha };
const deploy = { id: 'd-1', status: 'live', commit: { id: sha } };
const quiet = { info() {} };

test('deploys one Render service then checks API health and login on its URL', async () => {
  const calls = [];
  await deployStaging({ env, logger: quiet, fetchImpl: async (input, options = {}) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: 'd-1' });
    if (url.pathname.endsWith('/deploys/d-1')) return Response.json(deploy);
    if (url.pathname === '/api/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/login') return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  }});
  assert.equal(calls.filter(({url}) => url.pathname.startsWith('/deploy/')).length, 1);
  assert.ok(calls.some(({url}) => url.pathname === '/api/health'));
  assert.ok(calls.some(({url}) => url.pathname === '/login'));
});

test('validates deployment settings before making requests', async () => {
  let calls = 0;
  await assert.rejects(deployStaging({ env: { ...env, STAGING_DEPLOY_ENABLED: 'false' }, fetchImpl: async () => { calls++; } }), /disabled/);
  await assert.rejects(deployStaging({ env: { ...env, RENDER_DEPLOY_HOOK_URL: 'https://attacker.example/deploy/x' }, fetchImpl: async () => { calls++; } }), /Render deploy hook/);
  assert.equal(calls, 0);
});

test('fails on unhealthy API response', async () => {
  await assert.rejects(deployStaging({ env, logger: quiet, fetchImpl: async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/deploy/')) return Response.json({ id: 'd-1' });
    if (url.pathname.endsWith('/deploys/d-1')) return Response.json(deploy);
    if (url.pathname === '/api/health') return Response.json({ status: 'failed' });
    return new Response('', { status: 200 });
  }}), /API health check failed/);
});

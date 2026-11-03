import { pathToFileURL } from 'node:url';

const failures = new Set(['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed']);

function configFrom(env) {
  const keys = ['STAGING_DEPLOY_ENABLED', 'RENDER_DEPLOY_HOOK_URL', 'RENDER_API_TOKEN', 'STAGING_URL', 'GITHUB_SHA'];
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing staging deployment configuration: ${missing.join(', ')}.`);
  if (env.STAGING_DEPLOY_ENABLED !== 'true') throw new Error('Staging deployment is disabled.');
  if (!/^[a-f\d]{40}$/i.test(env.GITHUB_SHA)) throw new Error('GITHUB_SHA must be a full commit SHA.');
  const hook = new URL(env.RENDER_DEPLOY_HOOK_URL);
  const origin = new URL(env.STAGING_URL);
  if (hook.protocol !== 'https:' || hook.hostname !== 'api.render.com' || !hook.pathname.startsWith('/deploy/')) throw new Error('RENDER_DEPLOY_HOOK_URL must be a Render deploy hook URL.');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('STAGING_URL must be an HTTPS origin without credentials.');
  hook.searchParams.set('ref', env.GITHUB_SHA);
  return { hook, origin, serviceId: hook.pathname.slice('/deploy/'.length), token: env.RENDER_API_TOKEN, sha: env.GITHUB_SHA };
}

export async function deployStaging({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = 40, intervalMs = 15000, logger = console } = {}) {
  const config = configFrom(env);
  const triggered = await fetchImpl(config.hook, { method: 'POST', redirect: 'error' });
  if (![200, 202].includes(triggered.status)) throw new Error('Render rejected the staging deployment request.');
  let id;
  if (triggered.status === 200) ({ id } = await triggered.json());
  const statusUrl = new URL(`/v1/services/${encodeURIComponent(config.serviceId)}/deploys${id ? `/${encodeURIComponent(id)}` : ''}`, 'https://api.render.com');
  let live = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(statusUrl, { headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error('Render deployment status request failed.');
    const body = await response.json();
    const deploy = Array.isArray(body) ? body.map((item) => item.deploy ?? item).find((item) => item.commit?.id?.toLowerCase() === config.sha.toLowerCase()) : body;
    if (deploy && failures.has(deploy.status)) throw new Error(`Render deployment failed (${deploy.status}).`);
    if (deploy?.commit?.id?.toLowerCase() === config.sha.toLowerCase() && deploy.status === 'live') { live = true; break; }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  if (!live) throw new Error(`Render deployment did not become live after ${maxAttempts} attempts.`);
  for (const path of ['/api/health', '/login']) {
    const response = await fetchImpl(new URL(path, config.origin), { redirect: 'error' });
    if (!response.ok) throw new Error(`Staging health check failed for ${path}.`);
    if (path === '/api/health' && (await response.json()).status !== 'ok') throw new Error('Staging API health check failed.');
  }
  logger.info?.(`Staging deployment ${config.sha} is live and healthy.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) deployStaging().catch((error) => { console.error(JSON.stringify({ event: 'staging_deploy_failed', message: error.message })); process.exitCode = 1; });

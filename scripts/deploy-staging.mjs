import { pathToFileURL } from 'node:url';

const REQUIRED_ENV = [
  'STAGING_DEPLOY_ENABLED',
  'RENDER_API_DEPLOY_HOOK_URL',
  'RENDER_WEB_DEPLOY_HOOK_URL',
  'STAGING_API_URL',
  'STAGING_WEB_URL',
  'GITHUB_SHA',
];

function parseServiceUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }

  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !url.hostname.endsWith('.onrender.com')) {
    throw new Error(`${name} must be an assigned Render HTTPS origin.`);
  }

  return url;
}

function parseDeployHook(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid Render deploy hook URL.`);
  }

  if (url.protocol !== 'https:'
    || url.hostname !== 'api.render.com'
    || !url.pathname.startsWith('/deploy/')
    || url.pathname === '/deploy/'
    || url.username
    || url.password) {
    throw new Error(`${name} must be a Render deploy hook URL.`);
  }

  return url;
}

function readConfig(env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing staging deployment configuration: ${missing.join(', ')}.`);
  }
  if (env.STAGING_DEPLOY_ENABLED !== 'true') {
    throw new Error('Staging deployment is disabled.');
  }
  if (!/^[a-f\d]{40}$/i.test(env.GITHUB_SHA)) {
    throw new Error('GITHUB_SHA must be a full commit SHA.');
  }

  const apiHook = parseDeployHook(env.RENDER_API_DEPLOY_HOOK_URL, 'RENDER_API_DEPLOY_HOOK_URL');
  const webHook = parseDeployHook(env.RENDER_WEB_DEPLOY_HOOK_URL, 'RENDER_WEB_DEPLOY_HOOK_URL');
  const apiOrigin = parseServiceUrl(env.STAGING_API_URL, 'STAGING_API_URL');
  const webOrigin = parseServiceUrl(env.STAGING_WEB_URL, 'STAGING_WEB_URL');

  apiHook.searchParams.set('ref', env.GITHUB_SHA);
  webHook.searchParams.set('ref', env.GITHUB_SHA);

  return {
    apiHook,
    webHook,
    apiHealthUrl: new URL('/api/health', apiOrigin),
    webHealthUrl: new URL('/login', webOrigin),
    commitSha: env.GITHUB_SHA,
  };
}

async function triggerDeploy(fetchImpl, hookUrl, serviceName) {
  let response;
  try {
    response = await fetchImpl(hookUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Could not request the ${serviceName} staging deployment.`);
  }
  if (!response.ok) {
    throw new Error(`Render rejected the ${serviceName} staging deployment request.`);
  }
}

async function isHealthy(fetchImpl, url, serviceName) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    if (serviceName !== 'API') return true;
    const health = await response.json();
    return health.status === 'ok';
  } catch {
    return false;
  }
}

async function waitForHealth(fetchImpl, url, serviceName, { maxAttempts, intervalMs, sleep }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await isHealthy(fetchImpl, url, serviceName)) return;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new Error(`${serviceName} staging health check did not pass after ${maxAttempts} attempts.`);
}

export async function deployStaging({
  env = process.env,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console,
  maxAttempts = 20,
  intervalMs = 15_000,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0) {
    throw new Error('intervalMs must be a non-negative integer.');
  }

  const config = readConfig(env);

  logger.info?.(`Requesting Render deploys for commit ${config.commitSha}.`);
  await triggerDeploy(fetchImpl, config.apiHook, 'API');
  await triggerDeploy(fetchImpl, config.webHook, 'web');

  await Promise.all([
    waitForHealth(fetchImpl, config.apiHealthUrl, 'API', { maxAttempts, intervalMs, sleep }),
    waitForHealth(fetchImpl, config.webHealthUrl, 'Web', { maxAttempts, intervalMs, sleep }),
  ]);

  logger.info?.('Staging API and web health checks passed.');
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  deployStaging().catch((error) => {
    console.error(JSON.stringify({
      event: 'staging_deploy_failed',
      message: error.message,
    }));
    process.exitCode = 1;
  });
}

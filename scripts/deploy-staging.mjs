import { pathToFileURL } from 'node:url';

const REQUIRED_ENV = [
  'STAGING_DEPLOY_ENABLED',
  'RENDER_API_DEPLOY_HOOK_URL',
  'RENDER_WEB_DEPLOY_HOOK_URL',
  'RENDER_API_TOKEN',
  'STAGING_API_URL',
  'STAGING_WEB_URL',
  'GITHUB_SHA',
];

const TERMINAL_FAILURES = new Set([
  'build_failed',
  'update_failed',
  'canceled',
  'pre_deploy_failed',
]);

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

  const serviceId = url.pathname.slice('/deploy/'.length);
  if (!/^[a-zA-Z0-9_-]+$/.test(serviceId)) {
    throw new Error(`${name} must identify a valid Render service.`);
  }

  return { url, serviceId };
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

  apiHook.url.searchParams.set('ref', env.GITHUB_SHA);
  webHook.url.searchParams.set('ref', env.GITHUB_SHA);

  return {
    apiHook,
    webHook,
    apiHealthUrl: new URL('/api/health', apiOrigin),
    webHealthUrl: new URL('/login', webOrigin),
    commitSha: env.GITHUB_SHA,
    renderApiToken: env.RENDER_API_TOKEN,
  };
}

async function triggerDeploy(fetchImpl, hook, serviceName, commitSha, now) {
  const requestedAt = now();
  let response;
  try {
    response = await fetchImpl(hook.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Could not request the ${serviceName} staging deployment.`);
  }
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`Render rejected the ${serviceName} staging deployment request.`);
  }

  let deployId = null;
  if (response.status === 200) {
    try {
      ({ id: deployId } = await response.json());
    } catch {
      throw new Error(`Render did not return a deployment ID for the ${serviceName} service.`);
    }
    if (typeof deployId !== 'string' || deployId.length === 0) {
      throw new Error(`Render did not return a deployment ID for the ${serviceName} service.`);
    }
  }

  return { deployId, requestedAt, serviceId: hook.serviceId, serviceName, commitSha };
}

async function renderRequest(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Render deployment status request failed.');
  return response.json();
}

async function getRequestedDeployment(fetchImpl, request, token) {
  if (request.deployId) {
    const url = new URL(
      `/v1/services/${encodeURIComponent(request.serviceId)}/deploys/${encodeURIComponent(request.deployId)}`,
      'https://api.render.com',
    );
    return renderRequest(fetchImpl, url, token);
  }

  const url = new URL(
    `/v1/services/${encodeURIComponent(request.serviceId)}/deploys`,
    'https://api.render.com',
  );
  url.searchParams.set('limit', '20');
  const response = await renderRequest(fetchImpl, url, token);
  const deploys = Array.isArray(response)
    ? response.map((item) => item.deploy ?? item)
    : [];
  const requestWindowStart = request.requestedAt - 5_000;
  return deploys
    .filter((deploy) => deploy.commit?.id?.toLowerCase() === request.commitSha.toLowerCase()
      && Date.parse(deploy.createdAt) >= requestWindowStart)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

async function waitForDeployment(fetchImpl, request, token, {
  maxAttempts,
  intervalMs,
  sleep,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let deployment;
    try {
      deployment = await getRequestedDeployment(fetchImpl, request, token);
    } catch {
      if (attempt === maxAttempts) {
        throw new Error(`${request.serviceName} Render deployment status could not be verified.`);
      }
    }

    if (deployment) {
      if (TERMINAL_FAILURES.has(deployment.status)) {
        throw new Error(`${request.serviceName} Render deployment failed (${deployment.status}).`);
      }
      if (deployment.commit?.id?.toLowerCase() !== request.commitSha.toLowerCase()) {
        throw new Error(`${request.serviceName} Render deployment does not match the tested commit.`);
      }
      if (deployment.status === 'live') return;
    }

    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new Error(`${request.serviceName} Render deployment did not become live after ${maxAttempts} attempts.`);
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
  now = Date.now,
  logger = console,
  maxAttempts = 40,
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
  const apiRequest = await triggerDeploy(fetchImpl, config.apiHook, 'API', config.commitSha, now);
  const webRequest = await triggerDeploy(fetchImpl, config.webHook, 'Web', config.commitSha, now);

  await Promise.all([
    waitForDeployment(fetchImpl, apiRequest, config.renderApiToken, { maxAttempts, intervalMs, sleep }),
    waitForDeployment(fetchImpl, webRequest, config.renderApiToken, { maxAttempts, intervalMs, sleep }),
  ]);

  await Promise.all([
    waitForHealth(fetchImpl, config.apiHealthUrl, 'API', { maxAttempts, intervalMs, sleep }),
    waitForHealth(fetchImpl, config.webHealthUrl, 'Web', { maxAttempts, intervalMs, sleep }),
  ]);

  logger.info?.('Staging API and web deployments are live and health checks passed.');
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

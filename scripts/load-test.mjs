// Dependency-free load test for TC-PERF-01 (normal load, p95 <= 2 s) and TC-PERF-02 (100 concurrent
// virtual users). Runs a fixed, representative request mix against a running app seeded with the
// fixtures (`npm run seed`). Never point it at production: it writes task status changes.
//
//   node scripts/load-test.mjs --base-url http://localhost:3000 --vus 10 --duration 60
//   node scripts/load-test.mjs --base-url http://localhost:3000 --vus 100 --duration 60 --json out.json
//
// Reads use the four fixture accounts; each virtual user signs in once (so bcrypt cost is not
// counted as API latency) and then loops over the mix with a short think time.

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]?.startsWith('--') ? 'true' : all[index + 1] ?? 'true']);
  return pairs;
}, []));

const baseUrl = (args['base-url'] || 'http://localhost:3000').replace(/\/$/, '');
const vus = Number(args.vus || 10);
const durationSeconds = Number(args.duration || 60);
const thinkMs = Number(args.think || 250);
const password = args.password || 'Password123!';
const accounts = ['lead@example.test', 'member@example.test', 'admin@example.test', 'member.two.with.a.long.address@example.test'];
const P95_LIMIT_MS = 2000;

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl) && args['allow-remote'] !== 'true') {
  console.error('Refusing a non-local base URL. Use a dedicated staging environment and pass --allow-remote true.');
  process.exit(2);
}

const samples = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(name, method, path, { token, body } = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = response.status;
    await response.arrayBuffer();
  } catch {
    status = 0;
  }
  const sample = { name, ms: performance.now() - started, ok: status >= 200 && status < 400, status };
  samples.push(sample);
  return sample;
}

async function signIn(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed for ${email}: HTTP ${response.status}. Seed the fixtures first.`);
  return (await response.json()).token;
}

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ['To Do', 'In Progress', 'Done'];

async function virtualUser(index, token, deadline) {
  const lead = index % accounts.length === 0;
  let step = 0;
  while (performance.now() < deadline) {
    await call('GET /dashboard', 'GET', `/dashboard?today=${today}`, { token });
    await call('GET /notifications/unread-count', 'GET', '/notifications/unread-count', { token });
    await call('GET /projects', 'GET', '/projects', { token });
    await call('GET /projects/:id/tasks', 'GET', '/projects/project-alpha/tasks?page=1&pageSize=50', { token });
    await call('GET /tasks?q=', 'GET', '/tasks?q=release&page=1&pageSize=50', { token });
    await call('GET /notifications', 'GET', '/notifications?page=1', { token });
    if (lead) {
      // Write path: cycle a task created for this run through the board columns.
      step += 1;
      await call('PATCH /tasks/:id/status', 'PATCH', `/tasks/${encodeURIComponent(loadTaskId)}/status`, { token, body: { status: STATUSES[step % 3] } });
    }
    await sleep(thinkMs);
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(list) {
  const times = list.map((s) => s.ms).sort((a, b) => a - b);
  const errors = list.filter((s) => !s.ok).length;
  return {
    requests: list.length,
    errors,
    errorRate: list.length ? errors / list.length : 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times.at(-1) ?? 0,
  };
}

let loadTaskId;
const tokens = Object.fromEntries(await Promise.all(accounts.map(async (email) => [email, await signIn(email)])));
const created = await fetch(`${baseUrl}/api/projects/project-alpha/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens['lead@example.test']}` },
  body: JSON.stringify({ title: `Load test ${new Date().toISOString()}`, priority: 'Low' }),
});
if (!created.ok) throw new Error(`Could not create the load-test task: HTTP ${created.status}`);
loadTaskId = (await created.json()).id;

console.info(`Load test: ${vus} virtual users for ${durationSeconds}s against ${baseUrl} (think time ${thinkMs} ms)`);
const startedAt = new Date();
const started = performance.now();
const deadline = started + durationSeconds * 1000;
await Promise.all(Array.from({ length: vus }, (_, index) => virtualUser(index, tokens[accounts[index % accounts.length]], deadline)));
const elapsedSeconds = (performance.now() - started) / 1000;

await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(loadTaskId)}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${tokens['lead@example.test']}` },
});

const overall = summarize(samples);
const byEndpoint = Object.fromEntries([...new Set(samples.map((s) => s.name))].map((name) => [name, summarize(samples.filter((s) => s.name === name))]));
const report = {
  startedAt: startedAt.toISOString(),
  baseUrl,
  vus,
  durationSeconds,
  thinkMs,
  node: process.version,
  throughputPerSecond: overall.requests / elapsedSeconds,
  overall,
  byEndpoint,
  pass: overall.p95 <= P95_LIMIT_MS && overall.errorRate < 0.01,
};

const ms = (value) => `${value.toFixed(0)} ms`;
console.info(`\n| Endpoint | Requests | Errors | p50 | p95 | p99 |\n| --- | ---: | ---: | ---: | ---: | ---: |`);
for (const [name, s] of Object.entries(byEndpoint)) console.info(`| ${name} | ${s.requests} | ${s.errors} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} |`);
console.info(`| **All** | ${overall.requests} | ${overall.errors} | ${ms(overall.p50)} | ${ms(overall.p95)} | ${ms(overall.p99)} |`);
console.info(`\nThroughput ${report.throughputPerSecond.toFixed(1)} req/s · error rate ${(overall.errorRate * 100).toFixed(2)}% · p95 limit ${P95_LIMIT_MS} ms · ${report.pass ? 'PASS' : 'FAIL'}`);
if (args.json) await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.pass ? 0 : 1;

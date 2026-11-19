/**
 * Delivery forecast: when will the open work be done, and which due dates are at risk?
 *
 * Monte Carlo over the project's own history, the method flow-metrics tools (ActionableAgile,
 * Lighthouse) use, built in rather than bolted on. Each simulated day draws a day at random from
 * the last WINDOW_DAYS days and completes as many tasks as were completed that day. Repeating
 * that thousands of times gives a distribution of finish dates instead of one guess.
 *
 * Per-task risk: open tasks are assumed to finish in the order they would be picked up
 * (earliest due date first, work in progress before new work, then priority). A task's chance
 * of meeting its due date is the share of simulations in which its place in that queue is
 * reached by the due date.
 *
 * Pure and deterministic (seeded PRNG), so the numbers don't jump between renders.
 */

export const WINDOW_DAYS = 42;
export const MIN_COMPLETIONS = 3;
export const SIMULATIONS = 4000;
export const HORIZON_DAYS = 365;
/** Chance of meeting the due date at or above which a task is on track, and below which it is at risk. */
export const ON_TRACK = 0.85;
export const AT_RISK = 0.5;

const DAY_MS = 86_400_000;
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };

const dayNumber = (dateOnly) => Math.round(Date.parse(`${dateOnly}T00:00:00.000Z`) / DAY_MS);
const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, in the viewer's time zone. */
export function localDateOf(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/** Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Completions per day for the `windowDays` days ending today (oldest first). */
export function dailyThroughput(tasks, today, windowDays = WINDOW_DAYS) {
  const end = dayNumber(today);
  const start = end - windowDays + 1;
  const counts = new Array(windowDays).fill(0);
  for (const task of tasks) {
    if (task.status !== 'Done' || !task.completedAt) continue;
    const day = localDateOf(task.completedAt);
    if (!day) continue;
    const n = dayNumber(day);
    if (n >= start && n <= end) counts[n - start] += 1;
  }
  return counts;
}

/** Completed tasks per calendar week (7-day buckets ending today), oldest first. */
export function weeklyThroughput(tasks, today, weeks = WINDOW_DAYS / 7) {
  const daily = dailyThroughput(tasks, today, weeks * 7);
  return Array.from({ length: weeks }, (_, week) => {
    const count = daily.slice(week * 7, week * 7 + 7).reduce((sum, value) => sum + value, 0);
    return { weekEnding: fromDayNumber(dayNumber(today) - (weeks - 1 - week) * 7), count };
  });
}

/** The order open tasks are assumed to be finished in. */
export function workQueue(tasks) {
  return tasks
    .filter((task) => task.status !== 'Done')
    .sort((a, b) =>
      Number(!a.dueDate) - Number(!b.dueDate)
      || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
      || Number(a.status !== 'In Progress') - Number(b.status !== 'In Progress')
      || (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
      || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
      || String(a.id).localeCompare(String(b.id)));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/** 'on-track' | 'tight' | 'at-risk' for a chance of meeting the due date. */
export function riskLevel(probability) {
  if (probability >= ON_TRACK) return 'on-track';
  if (probability >= AT_RISK) return 'tight';
  return 'at-risk';
}

/**
 * @param {Array<{ id: string, status: string, priority?: string, dueDate?: string | null, completedAt?: string | null, createdAt?: string }>} tasks
 * @param {{ today: string, simulations?: number, windowDays?: number, seed?: number }} options
 * @returns {{
 *   state: 'empty' | 'complete' | 'insufficient' | 'stalled' | 'ready',
 *   remaining: number, completedInWindow: number, windowDays: number, simulations: number,
 *   averagePerWeek: number,
 *   finish: { p50: string | null, p85: string | null, p95: string | null } | null,
 *   risk: Map<string, { probability: number, level: string, queuePosition: number }>,
 * }}
 */
export function forecastProject(tasks, { today, simulations = SIMULATIONS, windowDays = WINDOW_DAYS, seed = 20261106 } = {}) {
  const queue = workQueue(tasks);
  const samples = dailyThroughput(tasks, today, windowDays);
  const completedInWindow = samples.reduce((sum, value) => sum + value, 0);
  const base = {
    remaining: queue.length,
    completedInWindow,
    windowDays,
    simulations: 0,
    averagePerWeek: Math.round((completedInWindow / windowDays) * 7 * 10) / 10,
    finish: null,
    risk: new Map(),
  };
  if (tasks.length === 0) return { ...base, state: 'empty' };
  if (queue.length === 0) return { ...base, state: 'complete' };
  if (completedInWindow < MIN_COMPLETIONS) return { ...base, state: 'insufficient' };

  const todayN = dayNumber(today);
  const random = seededRandom(seed);
  const remaining = queue.length;
  // finishDay[k] for the current simulation: days from today until the (k+1)-th task is done.
  const finishDays = new Array(simulations);
  // hits[k] = simulations in which task k is done by its due date.
  const deadlines = queue.map((task) => (task.dueDate ? dayNumber(task.dueDate) - todayN : null));
  const hits = new Array(remaining).fill(0);

  for (let s = 0; s < simulations; s += 1) {
    let done = 0;
    let day = 0;
    while (done < remaining && day <= HORIZON_DAYS) {
      const completed = samples[Math.floor(random() * samples.length)];
      for (let k = done; k < Math.min(remaining, done + completed); k += 1) {
        // Work finished "today" counts as day 0, so a task due today can still make it.
        if (deadlines[k] !== null && day <= deadlines[k]) hits[k] += 1;
      }
      done += completed;
      if (done < remaining) day += 1;
    }
    finishDays[s] = done >= remaining ? day : Infinity;
  }

  finishDays.sort((a, b) => a - b);
  const toDate = (days) => (Number.isFinite(days) ? fromDayNumber(todayN + days) : null);
  const finish = {
    p50: toDate(percentile(finishDays, 0.5)),
    p85: toDate(percentile(finishDays, 0.85)),
    p95: toDate(percentile(finishDays, 0.95)),
  };

  const risk = new Map();
  queue.forEach((task, index) => {
    // Overdue tasks are already flagged as overdue; a forecast adds nothing there.
    if (deadlines[index] === null || deadlines[index] < 0) return;
    const probability = hits[index] / simulations;
    risk.set(task.id, { probability, level: riskLevel(probability), queuePosition: index + 1 });
  });

  return { ...base, simulations, state: finish.p50 ? 'ready' : 'stalled', finish, risk };
}

/**
 * Work-item keys, as in Jira: every project has a short key (`ALPHA`) and every task a number in
 * its project, so a task reads as `ALPHA-12`. Shared by the API, the mock API and the UI.
 *
 * Pure functions only, no imports: it runs in Node and in the browser.
 */

export const PROJECT_KEY_MIN = 2;
export const PROJECT_KEY_MAX = 10;
const PROJECT_KEY_PATTERN = /^[A-Z]{2,10}$/;
const TASK_KEY_PATTERN = /^([A-Za-z]{2,10})-(\d{1,9})$/;

/** Upper-cases and trims what someone typed as a project key. */
export function normalizeProjectKey(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** Why `key` (already normalized) is not a valid project key, or null when it is. */
export function projectKeyError(key) {
  if (!key) return 'Give the project a key.';
  if (!PROJECT_KEY_PATTERN.test(key)) return `Use ${PROJECT_KEY_MIN} to ${PROJECT_KEY_MAX} letters A to Z, for example ALPHA.`;
  return null;
}

/** `ALPHA-12`, or null when the task has no number yet (or the project has no key). */
export function formatTaskKey(projectKey, number) {
  if (!projectKey || !Number.isInteger(number) || number < 1) return null;
  return `${projectKey}-${number}`;
}

/** `{ projectKey: 'ALPHA', number: 12 }` for text like `alpha-12`, otherwise null. */
export function parseTaskKey(text) {
  const match = typeof text === 'string' ? TASK_KEY_PATTERN.exec(text.trim()) : null;
  if (!match) return null;
  const number = Number(match[2]);
  return number >= 1 ? { projectKey: match[1].toUpperCase(), number } : null;
}

/** Whether a project currently or previously used `key`, so old links keep resolving. */
export function projectAnswersToKey(project, key) {
  return Boolean(project) && (project.key === key || (project.previousKeys ?? []).includes(key));
}

const lettersOf = (word) => word.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase();

/**
 * A key suggested from the project name that is not in `taken` (a Set of keys already used in
 * the organisation, current or previous). "Alpha Project" -> ALPHA; "QA" -> QA; a name with no
 * usable letters -> PROJ. Falls back to adding letters (ALPHAB, ALPHAC, ...) to stay unique.
 */
export function suggestProjectKey(name, taken = new Set()) {
  const words = String(name ?? '').split(/\s+/).map(lettersOf).filter(Boolean);
  const first = words[0] ?? '';
  const initials = words.map((word) => word[0]).join('');
  const candidates = [];
  if (first.length >= PROJECT_KEY_MIN) candidates.push(first.slice(0, 5));
  if (initials.length >= PROJECT_KEY_MIN) candidates.push(initials.slice(0, PROJECT_KEY_MAX));
  if (first.length >= PROJECT_KEY_MIN && words[1]) candidates.push((first.slice(0, 4) + words[1][0]).slice(0, PROJECT_KEY_MAX));
  if (candidates.length === 0) candidates.push((first + 'PROJ').slice(0, 4).padEnd(PROJECT_KEY_MIN, 'X'));
  for (const candidate of candidates) if (!taken.has(candidate)) return candidate;
  const base = candidates[0].slice(0, PROJECT_KEY_MAX - 2);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of alphabet) {
    if (!taken.has(base + a)) return base + a;
  }
  for (const a of alphabet) {
    for (const b of alphabet) if (!taken.has(base + a + b)) return base + a + b;
  }
  throw new Error('No project key available.');
}

/**
 * Numbers tasks that have none, per project, oldest first, after the highest number already
 * used. Returns `{ tasks, counters }`: the tasks with `number` set and, per project id, the
 * highest number now in use. Pure; the mock API seeds with it.
 */
export function numberTasks(tasks, counters = {}) {
  const next = { ...counters };
  for (const task of tasks) {
    if (Number.isInteger(task.number)) next[task.projectId] = Math.max(next[task.projectId] ?? 0, task.number);
  }
  const unnumbered = tasks
    .filter((task) => !Number.isInteger(task.number))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const assigned = new Map();
  for (const task of unnumbered) {
    next[task.projectId] = (next[task.projectId] ?? 0) + 1;
    assigned.set(task, next[task.projectId]);
  }
  return {
    tasks: tasks.map((task) => (assigned.has(task) ? { ...task, number: assigned.get(task) } : task)),
    counters: next,
  };
}

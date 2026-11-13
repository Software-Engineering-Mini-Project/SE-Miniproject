/**
 * Work-item keys, as in Jira: every project has a short key (`ALPHA`) and every task a number in
 * its project, so a task reads as `ALPHA-12`. Shared by the API, the mock API and the UI.
 *
 * Also the work-item fields: type (Task, Bug, Story, Epic), story points, labels and epics.
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

// ---------- Work-item types, story points, labels and epics (issue #74) ----------

export const TASK_TYPES = ['Task', 'Bug', 'Story', 'Epic'];
export const DEFAULT_TASK_TYPE = 'Task';
/** Planning-poker values; anything else is refused. */
export const STORY_POINTS = [1, 2, 3, 5, 8, 13, 21];
export const LABEL_MAX = 30;
export const LABELS_PER_TASK = 10;
const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._/+-]*$/u;

/** `" Front End "` -> `front-end`; a leading `#` is dropped, so `#ui` and `ui` are one label. */
export function normalizeLabel(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
}

/** Why `label` (already normalized) is not usable, or null when it is. */
export function labelError(label) {
  if (!label) return 'A label needs at least one letter or digit.';
  if (label.length > LABEL_MAX) return `Keep labels to ${LABEL_MAX} characters or fewer.`;
  if (!LABEL_PATTERN.test(label)) return 'Labels use letters, digits and - _ . / + only.';
  return null;
}

/**
 * Reads the work-item fields of a task create (`create: true`, missing fields get defaults) or
 * update (only the fields sent). Returns `{ values, errors }`; `errors` maps a field to a message.
 * Whether an epic exists and fits is checked separately (`epicRuleErrors`), with the database.
 */
export function readWorkItemFields(body, { create = false } = {}) {
  const values = {};
  const errors = {};
  if (create || body.type !== undefined) {
    if (body.type === undefined) values.type = DEFAULT_TASK_TYPE;
    else if (typeof body.type === 'string' && TASK_TYPES.includes(body.type)) values.type = body.type;
    else errors.type = `Choose ${TASK_TYPES.join(', ')}.`;
  }
  if (create || body.storyPoints !== undefined) {
    const points = body.storyPoints;
    if (points === undefined || points === null) values.storyPoints = null;
    else if (typeof points === 'number' && STORY_POINTS.includes(points)) values.storyPoints = points;
    else errors.storyPoints = `Use ${STORY_POINTS.join(', ')} or no estimate.`;
  }
  if (create || body.labels !== undefined) {
    const raw = body.labels ?? [];
    if (!Array.isArray(raw) || raw.some((label) => typeof label !== 'string')) {
      errors.labels = 'Labels must be a list of text.';
    } else {
      const labels = [...new Set(raw.map(normalizeLabel))];
      const problem = labels.map(labelError).find(Boolean);
      if (problem) errors.labels = problem;
      else if (labels.length > LABELS_PER_TASK) errors.labels = `A task can have at most ${LABELS_PER_TASK} labels.`;
      else values.labels = labels;
    }
  }
  if (create || body.epicId !== undefined) {
    const epicId = body.epicId;
    if (epicId === undefined || epicId === null || epicId === '') values.epicId = null;
    else if (typeof epicId === 'string' && epicId.length <= 64) values.epicId = epicId;
    else errors.epicId = 'Choose an epic from this project.';
  }
  return { values, errors };
}

/**
 * The epic rules, given the task as it is now (`current`, null when creating), as it will be
 * (`next`: its id, projectId, type and epicId), the epic `next.epicId` names (null if none was
 * found) and how many items the task holds as an epic. Returns field errors; empty when fine.
 */
export function epicRuleErrors({ current = null, next, epic = null, childCount = 0 }) {
  const errors = {};
  if (next.epicId) {
    if (next.type === 'Epic') errors.epicId = 'An epic cannot belong to another epic.';
    else if (current && next.epicId === current.id) errors.epicId = 'A task cannot be its own epic.';
    else if (!epic || epic.type !== 'Epic' || String(epic.projectId) !== String(next.projectId)) errors.epicId = 'Choose an epic from this project.';
  }
  if (current?.type === 'Epic' && next.type !== 'Epic' && childCount > 0) {
    errors.type = `Move the ${childCount} ${childCount === 1 ? 'item' : 'items'} out of this epic first.`;
  }
  return errors;
}

/** Progress of an epic from its child items: counts by status, story points and percent done. */
export function epicProgress(epicId, tasks) {
  const children = tasks.filter((task) => task.epicId === epicId);
  const done = children.filter((task) => task.status === 'Done');
  const sum = (list) => list.reduce((total, task) => total + (task.storyPoints ?? 0), 0);
  return {
    total: children.length,
    done: done.length,
    inProgress: children.filter((task) => task.status === 'In Progress').length,
    points: sum(children),
    donePoints: sum(done),
    percent: children.length ? Math.round((done.length / children.length) * 100) : 0,
  };
}

/** Every label used in a project's tasks with how often, most used first. */
export function projectLabels(tasks) {
  const counts = new Map();
  for (const task of tasks) for (const label of task.labels ?? []) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count }));
}

/** A task's work-item fields with defaults, for records saved before types existed. */
export function withWorkItemDefaults(task) {
  return {
    ...task,
    type: TASK_TYPES.includes(task.type) ? task.type : DEFAULT_TASK_TYPE,
    storyPoints: STORY_POINTS.includes(task.storyPoints) ? task.storyPoints : null,
    labels: Array.isArray(task.labels) ? task.labels : [],
    epicId: task.epicId ?? null,
  };
}

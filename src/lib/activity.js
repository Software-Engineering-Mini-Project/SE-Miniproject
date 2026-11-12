/**
 * Task activity history (issue #75): which entries a change writes, and how an entry reads.
 * Shared by the API, the mock API and the UI. Pure functions only, no imports.
 *
 * An entry is `{ action, details }` plus who (`actorId`), which task and when. Actions:
 *   created                                   { title, type }
 *   title | status | priority | dueDate | type | storyPoints | epicId     { from, to }
 *   description                               {}
 *   assignees | labels                        { added: [...], removed: [...] }
 *   checklist.add | checklist.remove          { text }
 *   checklist.check                           { text, done }
 *   checklist.rename                          { from, to }
 *   comment.add                               { commentId, excerpt (null once the comment is deleted) }
 *   comment.delete                            { commentId }
 */

export const ACTIVITY_ACTIONS = [
  'created', 'title', 'description', 'status', 'priority', 'dueDate', 'type', 'storyPoints', 'epicId',
  'assignees', 'labels', 'checklist.add', 'checklist.check', 'checklist.rename', 'checklist.remove',
  'comment.add', 'comment.delete',
];

const EXCERPT_MAX = 120;
const SCALAR_FIELDS = ['title', 'status', 'priority', 'dueDate', 'type', 'storyPoints', 'epicId'];

const sameValue = (a, b) => (a ?? null) === (b ?? null);
const difference = (a = [], b = []) => a.filter((item) => !b.includes(item));

/** The first characters of a comment, for "commented on ALPHA-12: ...". */
export function commentExcerpt(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat;
}

/**
 * One entry per field that changed between `before` and `after` (plain task objects): an
 * update that changes the status and the priority writes two entries, one that changes nothing
 * writes none. Lists (assignees, labels) write one entry with what was added and removed.
 */
export function taskChangeActivities(before, after) {
  const entries = [];
  for (const field of SCALAR_FIELDS) {
    if (!sameValue(before[field], after[field])) entries.push({ action: field, details: { from: before[field] ?? null, to: after[field] ?? null } });
  }
  if ((before.description ?? '') !== (after.description ?? '')) entries.push({ action: 'description', details: {} });
  for (const [field, action] of [['assigneeIds', 'assignees'], ['labels', 'labels']]) {
    const added = difference(after[field], before[field]);
    const removed = difference(before[field], after[field]);
    if (added.length || removed.length) entries.push({ action, details: { added, removed } });
  }
  return entries;
}

/** The fields an edit can change, copied so the "before" survives the edit. */
export function taskSnapshot(task) {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? null,
    type: task.type ?? 'Task',
    storyPoints: task.storyPoints ?? null,
    epicId: task.epicId ?? null,
    assigneeIds: [...(task.assigneeIds ?? [])].map(String),
    labels: [...(task.labels ?? [])],
  };
}

/** "Alpha, Beta and Gamma". */
function listOf(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const quote = (text) => `"${text}"`;

/**
 * What an entry says after the actor's name, e.g. `moved ALPHA-12 from To Do to In Progress`.
 * `taskKey` names the task (falls back to "this task"); `nameOf(userId)` and `taskTitleOf(id)`
 * turn ids into names; `formatDay(YYYY-MM-DD)` formats due dates.
 */
export function describeActivity(entry, { taskKey, nameOf = (id) => id, taskTitleOf = () => null, formatDay = (day) => day } = {}) {
  const task = taskKey || 'this task';
  const d = entry.details ?? {};
  switch (entry.action) {
    case 'created':
      return `created ${task}`;
    case 'title':
      return `renamed ${task} to ${quote(d.to)}`;
    case 'description':
      return `edited the description of ${task}`;
    case 'status':
      return `moved ${task} from ${d.from} to ${d.to}`;
    case 'priority':
      return `changed the priority of ${task} from ${d.from} to ${d.to}`;
    case 'type':
      return `changed ${task} from ${d.from ?? 'Task'} to ${d.to}`;
    case 'dueDate':
      if (!d.to) return `removed the due date of ${task}`;
      if (!d.from) return `set ${task} due ${formatDay(d.to)}`;
      return `moved the due date of ${task} from ${formatDay(d.from)} to ${formatDay(d.to)}`;
    case 'storyPoints':
      if (!d.to) return `removed the estimate of ${task}`;
      if (!d.from) return `estimated ${task} at ${d.to} ${d.to === 1 ? 'point' : 'points'}`;
      return `changed the estimate of ${task} from ${d.from} to ${d.to} points`;
    case 'epicId': {
      const to = d.to ? taskTitleOf(d.to) ?? 'an epic' : null;
      const from = d.from ? taskTitleOf(d.from) ?? 'its epic' : null;
      if (!to) return `took ${task} out of ${from ? quote(from) : 'its epic'}`;
      return from ? `moved ${task} from ${quote(from)} to ${quote(to)}` : `added ${task} to the epic ${quote(to)}`;
    }
    case 'assignees': {
      const added = (d.added ?? []).map(nameOf);
      const removed = (d.removed ?? []).map(nameOf);
      const parts = [];
      if (added.length) parts.push(`assigned ${listOf(added)} to ${task}`);
      // "assigned Mina to ALPHA-1 and unassigned Lena", or "unassigned Lena from ALPHA-1".
      if (removed.length) parts.push(`unassigned ${listOf(removed)}${added.length ? '' : ` from ${task}`}`);
      return parts.join(' and ');
    }
    case 'labels': {
      const parts = [];
      if (d.added?.length) parts.push(`added ${d.added.length === 1 ? 'the label' : 'the labels'} ${listOf(d.added)}`);
      if (d.removed?.length) parts.push(`removed ${d.removed.length === 1 ? 'the label' : 'the labels'} ${listOf(d.removed)}`);
      return `${parts.join(' and ')} on ${task}`;
    }
    case 'checklist.add':
      return `added ${quote(d.text)} to the checklist of ${task}`;
    case 'checklist.check':
      return `${d.done ? 'ticked off' : 'unticked'} ${quote(d.text)} on ${task}`;
    case 'checklist.rename':
      return `renamed the checklist item ${quote(d.from)} to ${quote(d.to)} on ${task}`;
    case 'checklist.remove':
      return `removed ${quote(d.text)} from the checklist of ${task}`;
    case 'comment.add':
      return d.excerpt ? `commented on ${task}: ${quote(d.excerpt)}` : `commented on ${task}`;
    case 'comment.delete':
      return `deleted a comment on ${task}`;
    default:
      return `changed ${task}`;
  }
}

/**
 * Entries for seeded data, so a fresh database has some history: each task was created by its
 * project's owner, and each comment added by its author. Ids are derived from the records'.
 */
export function seedActivities({ tasks, comments, projects }) {
  const ownerOf = new Map(projects.map((project) => [project.id, project.ownerId]));
  const projectOf = new Map(tasks.map((task) => [task.id, task.projectId]));
  return [
    ...tasks.map((task) => ({
      id: `activity-${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      actorId: ownerOf.get(task.projectId) ?? null,
      action: 'created',
      details: { title: task.title, type: task.type ?? 'Task' },
      createdAt: task.createdAt,
    })),
    ...comments.filter((comment) => projectOf.has(comment.taskId)).map((comment) => ({
      id: `activity-${comment.id}`,
      taskId: comment.taskId,
      projectId: projectOf.get(comment.taskId),
      actorId: comment.authorId,
      action: 'comment.add',
      details: { commentId: comment.id, excerpt: commentExcerpt(comment.text) },
      createdAt: comment.createdAt,
    })),
  ];
}

// In-browser mock of the Express REST API (SRS §3.2, SAD §4).
//
// It exists so the UI can be built, demoed and tested before the backend is ready.
// It mirrors the contract the backend must honour: the same paths, status codes,
// the { errorCode, message, timestamp } envelope, role and project-membership checks,
// input validation and safe CSV export. It is NOT a security boundary — the real
// Express API is authoritative (PRJ-SR-003). Passwords here are synthetic fixtures.

import { resolveToday } from '../../dates.js';
import {
  LIMITS,
  REMINDER_WINDOW_HOURS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../constants.js';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  GRANTABLE_PROJECT_ROLES,
  PROJECT_CREATION,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  can,
  canCreateProject,
  isAdmin,
  memberRemovalError,
  memberRoleChangeError,
  projectRoleOf,
  roleAllows,
  rolesForNewMember,
  withMemberRole,
  withoutMember,
} from '../../permissions.js';
import {
  ORGANISATION_NAME_MAX,
  formatJoinCode,
  generateJoinCode,
  isJoinCodeShape,
  normalizeJoinCode,
} from '../../organisation.js';
import {
  TASK_TYPES,
  epicRuleErrors,
  formatTaskKey,
  labelError,
  normalizeLabel,
  normalizeProjectKey,
  numberTasks,
  parseTaskKey,
  projectAnswersToKey,
  projectKeyError,
  readWorkItemFields,
  suggestProjectKey,
  withWorkItemDefaults,
} from '../../work-items.js';
import { commentExcerpt, seedActivities, taskChangeActivities, taskSnapshot } from '../../activity.js';
import {
  INVITATION_LIST_LIMIT,
  generateInvitationToken,
  invitationEmailMismatch,
  invitationExpiry,
  invitationPath,
  invitationProblem,
  invitationState,
  isInvitationTokenShape,
} from '../../invitations.js';
import {
  commitmentOf,
  completionPlan,
  leavesCompletedSprint,
  nextRank,
  rankBetween,
  readSprintFields,
  renumberRanks,
  sprintName,
  sprintTargetError,
} from '../../sprints.js';
import { buildSprintReport } from '../../sprint-report.js';
import { toCsv } from './csv.js';

export const MOCK_PASSWORD = 'Password123!';
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = ['Admin', 'Lead', 'Member'];
const FORBIDDEN = {
  'project.edit': 'Only the project owner, a manager or an admin can edit this project.',
  'project.delete': 'Only the project owner or an admin can delete this project.',
  'project.key': 'Only the project owner or an admin can change the project key.',
  'members.manage': 'Only the project owner, a manager or an admin can manage members.',
  'task.create': 'Viewers cannot create tasks.',
  'task.edit': 'Viewers cannot edit tasks.',
  'task.delete': 'Only the project owner, a manager or an admin can delete tasks.',
  'task.status': 'Viewers cannot change task status.',
  'sprint.manage': 'Only the project owner, a manager or an admin can create, start and complete sprints.',
  'comment.create': 'You cannot comment in this project.',
};

class HttpError extends Error {
  constructor(status, errorCode, message, fields) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.fields = fields;
  }
}

const fail = (status, errorCode, message, fields) => {
  throw new HttpError(status, errorCode, message, fields);
};
const badRequest = (message, fields) => fail(400, 'VALIDATION_ERROR', message, fields);
const forbidden = (message = 'You do not have permission to do this.') => fail(403, 'FORBIDDEN', message);
const notFound = (what = 'Resource') => fail(404, 'NOT_FOUND', `${what} not found.`);

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeEmail = (email) => email.trim().toLowerCase();

function encodeToken(payload) {
  const json = JSON.stringify(payload);
  const b64 = typeof btoa === 'function' ? btoa(json) : Buffer.from(json).toString('base64');
  return `mock.${b64}.sig`;
}

function decodeToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'mock' || parts[2] !== 'sig') return null;
  try {
    const json = typeof atob === 'function' ? atob(parts[1]) : Buffer.from(parts[1], 'base64').toString();
    const payload = JSON.parse(json);
    return typeof payload?.sub === 'string' && typeof payload?.exp === 'number' ? payload : null;
  } catch {
    return null;
  }
}

/** Builds the initial database from fixture JSON. */
export function seedDatabase(seed) {
  return {
    organisations: clone(seed.organisations ?? []),
    users: seed.users.map((u) => ({
      ...clone(u),
      emailNormalized: normalizeEmail(u.email),
      password: MOCK_PASSWORD,
    })),
    ...(() => {
      const { tasks, counters } = numberTasks(clone(seed.tasks));
      return {
        projects: clone(seed.projects).map((p) => ({
          managerIds: [], viewerIds: [], visibility: 'private', previousKeys: [], ...p,
          taskCounter: counters[p.id] ?? 0,
          sprintCounter: (seed.sprints ?? []).filter((sprint) => sprint.projectId === p.id).reduce((max, sprint) => Math.max(max, sprint.number), 0),
        })),
        tasks: tasks.map(withWorkItemDefaults),
      };
    })(),
    comments: clone(seed.comments),
    notifications: clone(seed.notifications),
    sprints: clone(seed.sprints ?? []),
    activities: seedActivities({ tasks: clone(seed.tasks), comments: clone(seed.comments), projects: clone(seed.projects), sprints: clone(seed.sprints ?? []) }),
    counter: 1000,
  };
}

/**
 * @param {object} options
 * @param {object} options.seed fixture data ({ users, projects, tasks, comments, notifications })
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void } | null} [options.storage]
 * @param {() => Date} [options.now]
 * @param {string} [options.storageKey]
 */
export function createMockServer({ seed, storage = null, now = () => new Date(), storageKey = 'taskline.mockdb.v4' }) {
  let db = load();
  const loginAttempts = new Map();

  function load() {
    if (storage) {
      try {
        const saved = storage.getItem(storageKey);
        if (saved) return JSON.parse(saved);
      } catch {
        // Corrupt or blocked storage: fall back to the seed.
      }
    }
    return seedDatabase(seed);
  }

  function save() {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(db));
    } catch {
      // Storage full or blocked; the session keeps working in memory.
    }
  }

  function reset() {
    db = seedDatabase(seed);
    if (storage) {
      try {
        storage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }

  const nextId = (prefix) => `${prefix}-${++db.counter}`;
  const orgOf = (user) => db.organisations.find((organisation) => organisation.id === user.organisationId);
  const settings = (user) => ({ projectCreation: orgOf(user)?.projectCreation ?? DEFAULT_WORKSPACE_SETTINGS.projectCreation });
  /** Nothing crosses organisations. */
  const sameOrg = (user, record) => Boolean(user.organisationId) && record.organisationId === user.organisationId;
  const memberCount = (user) => db.users.filter((u) => sameOrg(user, u) && !u.deactivatedAt).length;
  const organisationDto = (user) => {
    const organisation = orgOf(user);
    if (!organisation) notFound('Organisation');
    const admin = isAdmin(user);
    return {
      id: organisation.id,
      name: organisation.name,
      projectCreation: organisation.projectCreation ?? DEFAULT_WORKSPACE_SETTINGS.projectCreation,
      createdAt: organisation.createdAt,
      memberCount: memberCount(user),
      ...(admin ? { projectCount: db.projects.filter((p) => sameOrg(user, p)).length, joinCode: formatJoinCode(organisation.joinCode) } : {}),
    };
  };
  const freshJoinCode = () => {
    let code = generateJoinCode();
    while (db.organisations.some((o) => o.joinCode === code)) code = generateJoinCode();
    return code;
  };
  const stamp = () => now().toISOString();

  // ---------- DTO mapping (never expose password / passwordHash) ----------
  const userDto = (u, { withOrganisation = false } = {}) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: !u.deactivatedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    ...(withOrganisation && orgOf(u) ? { organisation: { id: orgOf(u).id, name: orgOf(u).name } } : {}),
  });
  const memberDto = (u, project) => {
    const dto = { id: u.id, name: u.name, email: u.email, role: u.role, active: !u.deactivatedAt };
    if (project) dto.projectRole = projectRoleOf(project, u.id);
    return dto;
  };
  const findUser = (id) => db.users.find((u) => u.id === id);
  const projectDto = (p) => {
    const dto = {
      visibility: 'private',
      ...clone(p),
      key: p.key ?? null,
      previousKeys: [...(p.previousKeys ?? [])],
      managerIds: [...(p.managerIds ?? [])],
      viewerIds: [...(p.viewerIds ?? [])],
      members: p.memberIds.map(findUser).filter(Boolean).map((u) => memberDto(u, p)),
    };
    delete dto.taskCounter;
    return dto;
  };
  const projectKeyOf = (projectId) => db.projects.find((p) => p.id === projectId)?.key ?? null;
  const taskDto = (t) => {
    const dto = withWorkItemDefaults(clone(t));
    dto.number = Number.isInteger(t.number) ? t.number : null;
    dto.key = formatTaskKey(projectKeyOf(t.projectId), dto.number);
    return dto;
  };
  const taskKeyOf = (t) => formatTaskKey(projectKeyOf(t.projectId), t.number);

  // ---------- work-item keys (mirrors server/services/work-items.js) ----------
  const takenKeys = (user, exceptId) => new Set(db.projects
    .filter((p) => sameOrg(user, p) && p.id !== exceptId)
    .flatMap((p) => [p.key, ...(p.previousKeys ?? [])])
    .filter(Boolean));
  function readKey(body) {
    const key = normalizeProjectKey(body?.key);
    const error = projectKeyError(key);
    if (error) badRequest(error, { key: error });
    return key;
  }
  const keyTaken = () => fail(409, 'KEY_TAKEN', 'Another project in your organisation uses that key.', { key: 'This key is taken. Choose another.' });
  /** Mirrors server/services/activity.js: one entry per change, by `user`, now. */
  function record(task, user, entries) {
    db.activities ??= [];
    const at = stamp();
    for (const entry of entries) {
      db.activities.push({ id: nextId('activity'), taskId: task.id, projectId: task.projectId, actorId: user.id, action: entry.action, details: entry.details ?? {}, createdAt: at });
    }
  }
  // ---------- personal invitation links (mirrors server/routes/organisation.js, issue #78) ----------
  // The real API stores only a hash of each link's secret; this in-browser stand-in keeps the
  // token itself, since the whole database already lives in the browser.
  const invitationList = () => (db.invitations ??= []);
  const invitationDto = (invitation) => ({
    id: invitation.id,
    email: invitation.email,
    state: invitationState(invitation, now()),
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt ?? null,
    revokedAt: invitation.revokedAt ?? null,
    createdBy: invitation.createdById ? { id: invitation.createdById, name: findUser(invitation.createdById)?.name ?? null } : null,
  });
  const invitationFail = (problem) => fail(problem.status, problem.errorCode, problem.message, problem.fields);
  function usableInvitation(token) {
    const invitation = isInvitationTokenShape(token) ? invitationList().find((item) => item.token === token) : undefined;
    const problem = invitationProblem(invitation ?? null, now());
    if (problem) invitationFail(problem);
    const organisation = db.organisations.find((o) => o.id === invitation.organisationId);
    if (!organisation) invitationFail(invitationProblem(null, now()));
    return { invitation, organisation };
  }

  // ---------- backlog and sprints (mirrors server/routes/sprints.js, issue #76) ----------
  const sprintList = () => (db.sprints ??= []);
  const sprintDto = (sprint) => clone({ goal: '', startedAt: null, completedAt: null, committed: null, report: null, ...sprint });
  function sprintFor(user, sprintId, { action = 'project.view' } = {}) {
    idParam(sprintId, 'sprint');
    const sprint = sprintList().find((item) => item.id === sprintId);
    if (!sprint) notFound('Sprint');
    return { sprint, project: projectFor(user, sprint.projectId, { action }) };
  }
  function readSprint(body, options) {
    const { values, errors } = readSprintFields(body ?? {}, options);
    const [field] = Object.keys(errors);
    if (field) badRequest(errors[field], errors);
    return values;
  }
  /** Gives every task in the project a rank when any lacks one, keeping the current order. */
  function ensureRanks(projectId, { force = false } = {}) {
    const tasks = db.tasks.filter((t) => t.projectId === projectId);
    if (!force && tasks.every((t) => typeof t.rank === 'number')) return;
    const ranks = new Map(renumberRanks(tasks).map(({ id, rank }) => [id, rank]));
    tasks.forEach((t) => {
      t.rank = ranks.get(t.id);
    });
  }
  function moveToSprint(tasks, to, user) {
    tasks.forEach((t) => {
      const from = t.sprintId ?? null;
      t.sprintId = to;
      t.updatedAt = stamp();
      record(t, user, [{ action: 'sprint', details: { from, to } }]);
    });
  }
  /** Reopening work finished in a completed sprint sends it back to the backlog. */
  function releaseFromCompletedSprint(task, fromStatus, user) {
    const sprint = task.sprintId ? sprintList().find((item) => item.id === task.sprintId) : null;
    if (!leavesCompletedSprint(sprint, fromStatus, task.status)) return;
    moveToSprint([task], null, user);
  }

  /** Mirrors the API's readTaskInput for the work-item fields: 400 with the field's message. */
  function readWorkItem(body, { create = false } = {}) {
    const { values, errors } = readWorkItemFields(body ?? {}, { create });
    const [field] = Object.keys(errors);
    if (field) badRequest(errors[field], errors);
    return values;
  }
  /** Mirrors checkEpicRules in server/routes/tasks.js. */
  function checkEpicRules({ current = null, next }) {
    const epic = next.epicId ? db.tasks.find((t) => t.id === next.epicId && t.projectId === next.projectId) : null;
    const childCount = current?.type === 'Epic' && next.type !== 'Epic'
      ? db.tasks.filter((t) => t.projectId === next.projectId && t.epicId === current.id).length
      : 0;
    const errors = epicRuleErrors({ current, next, epic, childCount });
    const [field] = Object.keys(errors);
    if (field) badRequest(errors[field], errors);
  }
  function nextTaskNumber(project) {
    project.taskCounter = (project.taskCounter ?? 0) + 1;
    return project.taskCounter;
  }
  /** Mirrors the API: a key search also matches the task with that number in a project that uses or used the key. */
  function keyMatch(task, filters, projects) {
    const parsed = parseTaskKey(filters.q);
    if (!parsed || task.number !== parsed.number) return false;
    return projects.some((p) => p.id === task.projectId && projectAnswersToKey(p, parsed.projectKey));
  }

  // ---------- validation helpers ----------
  function str(body, key, { required = true, min = 1, max = 200, label = key } = {}) {
    const value = body?.[key];
    if (value === undefined || value === null || value === '') {
      if (required) badRequest(`${label} is required.`, { [key]: `${label} is required.` });
      return undefined;
    }
    if (typeof value !== 'string') badRequest(`${label} must be text.`, { [key]: `${label} must be text.` });
    const trimmed = value.trim();
    if (trimmed.length < min) badRequest(`${label} is required.`, { [key]: `${label} is required.` });
    if (trimmed.length > max) badRequest(`${label} must be ${max} characters or fewer.`, { [key]: `Use ${max} characters or fewer.` });
    return trimmed;
  }

  function oneOf(body, key, allowed, { required = true, label = key } = {}) {
    const value = body?.[key];
    if (value === undefined) {
      if (required) badRequest(`${label} is required.`, { [key]: `${label} is required.` });
      return undefined;
    }
    if (typeof value !== 'string' || !allowed.includes(value)) {
      badRequest(`${label} must be one of: ${allowed.join(', ')}.`, { [key]: `Choose ${allowed.join(', ')}.` });
    }
    return value;
  }

  function dateOnly(body, key, { required = false, label = key } = {}) {
    const value = body?.[key];
    if (value === undefined || value === null || value === '') {
      if (required) badRequest(`${label} is required.`, { [key]: `${label} is required.` });
      return null;
    }
    if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      badRequest(`${label} must be a valid date.`, { [key]: 'Enter a valid date.' });
    }
    return value;
  }

  function idParam(value, what) {
    if (typeof value !== 'string' || !ID_RE.test(value)) badRequest(`Invalid ${what} id.`);
    return value;
  }

  function passwordRule(value, key = 'password') {
    if (typeof value !== 'string') badRequest('Password is required.', { [key]: 'Password is required.' });
    if (value.length < LIMITS.passwordMin || value.length > LIMITS.passwordMax || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
      badRequest('Password must be 8–128 characters and include a letter and a number.', {
        [key]: 'Use 8+ characters with a letter and a number.',
      });
    }
    return value;
  }

  // ---------- auth & authorization ----------
  function authenticate(token) {
    if (!token) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const payload = decodeToken(token);
    if (!payload) fail(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.');
    if (payload.exp * 1000 <= now().getTime()) fail(401, 'TOKEN_EXPIRED', 'Your session has expired. Sign in again.');
    const user = findUser(payload.sub);
    if (!user) fail(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.');
    if (user.deactivatedAt) fail(401, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated. Contact a workspace admin.');
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) fail(401, 'TOKEN_REVOKED', 'Your password was changed. Sign in again.');
    return user;
  }

  const isMember = (user, project) => can(user, 'project.view', project);

  function projectFor(user, projectId, { action = 'project.view' } = {}) {
    idParam(projectId, 'project');
    const project = db.projects.find((p) => p.id === projectId);
    // Another organisation's project looks exactly like one that doesn't exist, admins included.
    if (!project || !sameOrg(user, project)) notFound('Project');
    if (!isMember(user, project)) {
      // An open project can be joined, so say so; a private one stays opaque.
      if (project.visibility === 'open') fail(403, 'JOIN_REQUIRED', 'This project is open to everyone in the workspace. Join it to see its work.');
      forbidden('You are not a member of this project.');
    }
    if (action !== 'project.view' && !can(user, action, project)) forbidden(FORBIDDEN[action]);
    return project;
  }

  function taskFor(user, taskId, { action = 'project.view' } = {}) {
    idParam(taskId, 'task');
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) notFound('Task');
    const project = projectFor(user, task.projectId, { action });
    return { task, project };
  }

  const members = (project) => projectDto(project).members;

  function validateAssignees(body, project) {
    const value = body?.assigneeIds;
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
      badRequest('Assignees must be a list of user ids.', { assigneeIds: 'Choose valid assignees.' });
    }
    const unique = [...new Set(value)];
    const outsider = unique.find((id) => !project.memberIds.includes(id));
    if (outsider) {
      badRequest('Assignees must be members of the project.', { assigneeIds: 'Only project members can be assigned.' });
    }
    if (unique.some((id) => !roleAllows(projectRoleOf(project, id), 'task.assignable'))) {
      badRequest('Viewers cannot be assigned tasks.', { assigneeIds: 'Viewers cannot be assigned tasks.' });
    }
    return unique;
  }

  const issueToken = (user) => ({
    token: encodeToken({ sub: user.id, tv: user.tokenVersion ?? 0, exp: Math.floor(now().getTime() / 1000) + TOKEN_TTL_SECONDS }),
    expiresIn: TOKEN_TTL_SECONDS,
  });

  function notifyAssignment(task, userIds, actor) {
    for (const userId of userIds) {
      if (userId === actor.id) continue;
      db.notifications.push({
        id: nextId('notif'),
        userId,
        taskId: task.id,
        type: 'assignment',
        message: taskKeyOf(task) ? `You were assigned to ${taskKeyOf(task)} "${task.title}".` : `You were assigned to "${task.title}".`,
        read: false,
        createdAt: stamp(),
      });
    }
  }

  // TM-F-031: due within the window and not Done; one reminder per user, task and due date.
  function generateDueReminders(user) {
    const nowMs = now().getTime();
    const windowMs = REMINDER_WINDOW_HOURS * 60 * 60 * 1000;
    let created = false;
    for (const task of db.tasks) {
      if (task.status === 'Done' || !task.dueDate || !task.assigneeIds.includes(user.id)) continue;
      const dueMs = Date.parse(`${task.dueDate}T23:59:59Z`);
      if (dueMs < nowMs || dueMs - nowMs > windowMs) continue;
      const dedupeKey = `${task.id}:${task.dueDate}`;
      const exists = db.notifications.some(
        (n) => n.userId === user.id && n.type === 'due-date' && (n.dedupeKey === dedupeKey || n.taskId === task.id),
      );
      if (exists) continue;
      db.notifications.push({
        id: nextId('notif'),
        userId: user.id,
        taskId: task.id,
        type: 'due-date',
        message: taskKeyOf(task) ? `${taskKeyOf(task)} "${task.title}" is due within ${REMINDER_WINDOW_HOURS} hours.` : `"${task.title}" is due within ${REMINDER_WINDOW_HOURS} hours.`,
        read: false,
        createdAt: stamp(),
        dedupeKey,
      });
      created = true;
    }
    return created;
  }

  function maybeGenerateDueReminders(user) {
    const timestamp = now().getTime();
    const previous = user.lastReminderScanAt;
    if (previous != null && timestamp - previous < 15 * 60 * 1000) return;
    user.lastReminderScanAt = timestamp;
    try { generateDueReminders(user); } catch (error) { user.lastReminderScanAt = previous; throw error; }
  }

  // Mirrors the API: completedAt is stamped on entering Done and cleared on leaving it.
  function applyStatus(task, status) {
    if (status === task.status && (status !== 'Done' || task.completedAt)) return;
    task.status = status;
    task.completedAt = status === 'Done' ? stamp() : null;
  }

  function removeTaskCascade(taskId) {
    // Deletion policy used by the mock (decision pending in SAD §3.5): cascade comments and notifications.
    db.tasks = db.tasks.filter((t) => t.id !== taskId);
    // Deleting an epic keeps its items; they just no longer belong to an epic.
    db.tasks.forEach((t) => {
      if (t.epicId === taskId) t.epicId = null;
    });
    db.comments = db.comments.filter((c) => c.taskId !== taskId);
    db.notifications = db.notifications.filter((n) => n.taskId !== taskId);
    db.activities = (db.activities ?? []).filter((a) => a.taskId !== taskId);
  }

  function isOverdue(task, today = resolveToday(undefined, now())) {
    return task.status !== 'Done' && Boolean(task.dueDate) && task.dueDate < today;
  }

  function matchesFilters(task, query) {
    if (query.status && task.status !== query.status) return false;
    if (query.priority && task.priority !== query.priority) return false;
    if (query.assigneeId && !task.assigneeIds.includes(query.assigneeId)) return false;
    if (query.type && (task.type ?? 'Task') !== query.type) return false;
    if (query.label && !(task.labels ?? []).includes(query.label)) return false;
    if (query.epicId && task.epicId !== query.epicId) return false;
    if (query.q) {
      const needle = query.q.toLowerCase();
      if (!task.title.toLowerCase().includes(needle) && !(task.description || '').toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  function readFilters(query) {
    const filters = {};
    if (query.q !== undefined) {
      if (typeof query.q !== 'string') badRequest('Search text must be text.');
      filters.q = query.q.trim().slice(0, 200);
    }
    if (query.status) filters.status = oneOf(query, 'status', TASK_STATUSES, { label: 'Status' });
    if (query.priority) filters.priority = oneOf(query, 'priority', TASK_PRIORITIES, { label: 'Priority' });
    if (query.assigneeId) filters.assigneeId = idParam(query.assigneeId, 'assignee');
    if (query.projectId) filters.projectId = idParam(query.projectId, 'project');
    if (query.type) filters.type = oneOf(query, 'type', TASK_TYPES, { label: 'Type' });
    if (query.label) {
      const label = normalizeLabel(query.label);
      const problem = labelError(label);
      if (problem) badRequest(problem, { label: problem });
      filters.label = label;
    }
    if (query.epicId) filters.epicId = idParam(query.epicId, 'epic');
    return filters;
  }

  // ---------- routes ----------
  const routes = [
    ['POST', '/auth/register', ({ body }) => {
      const name = str(body, 'name', { max: LIMITS.nameMax, label: 'Name' });
      const emailRaw = str(body, 'email', { max: 254, label: 'Email' });
      if (!EMAIL_RE.test(emailRaw)) badRequest('Enter a valid email address.', { email: 'Enter a valid email address.' });
      const password = passwordRule(body?.password);
      // Join with an invitation link or an invite code (Member) or start an organisation (its first
      // Admin): exactly one.
      const hasInvite = body?.inviteToken !== undefined && body.inviteToken !== null && body.inviteToken !== '';
      const hasCode = body?.joinCode !== undefined && body.joinCode !== null && body.joinCode !== '';
      const hasName = body?.organisationName !== undefined && body.organisationName !== null && body.organisationName !== '';
      if (hasInvite && (hasCode || hasName)) badRequest('Join with the invitation link only.', { inviteToken: 'An invitation link already says which organisation you join.' });
      if (hasInvite && typeof body.inviteToken !== 'string') badRequest('Invitation must be text.', { inviteToken: 'Invitation must be text.' });
      if (hasCode && hasName) badRequest('Join an organisation or create one, not both.', { joinCode: 'Use an invite code or an organisation name, not both.' });
      if (!hasInvite && !hasCode && !hasName) badRequest('Join an organisation with an invite code, or create one.', { joinCode: "Enter your organisation's invite code, or create a new organisation." });
      let organisation;
      let invitation = null;
      if (hasCode) {
        if (typeof body.joinCode !== 'string') badRequest('Invite code must be text.', { joinCode: 'Invite code must be text.' });
        const code = normalizeJoinCode(body.joinCode);
        organisation = isJoinCodeShape(code) ? db.organisations.find((o) => o.joinCode === code) : undefined;
        if (!organisation) badRequest('That invite code is not recognised.', { joinCode: 'That invite code is not recognised. Check it with your admin.' });
      }
      const organisationName = hasName ? str(body, 'organisationName', { max: ORGANISATION_NAME_MAX, label: 'Organisation name' }) : undefined;
      const emailNormalized = normalizeEmail(emailRaw);
      if (db.users.some((u) => u.emailNormalized === emailNormalized)) {
        fail(409, 'DUPLICATE_EMAIL', 'An account with this email already exists.', { email: 'This email is already registered.' });
      }
      if (hasInvite) {
        ({ invitation, organisation } = usableInvitation(body.inviteToken));
        if (invitation.emailNormalized !== emailNormalized) invitationFail(invitationEmailMismatch(invitation.email));
      }
      const at = stamp();
      const startsOrganisation = !organisation;
      if (startsOrganisation) {
        organisation = { id: nextId('org'), name: organisationName, joinCode: freshJoinCode(), projectCreation: 'everyone', createdById: null, createdAt: at, updatedAt: at };
        db.organisations.push(organisation);
      }
      // Joining makes a Member; only starting an organisation makes an Admin (SRS §2.2).
      const role = startsOrganisation ? 'Admin' : 'Member';
      const user = { id: nextId('user'), organisationId: organisation.id, name, email: emailRaw, emailNormalized, role, password, createdAt: at, updatedAt: at };
      db.users.push(user);
      if (startsOrganisation) organisation.createdById = user.id;
      if (invitation) Object.assign(invitation, { acceptedAt: at, acceptedById: user.id });
      return [201, { userId: user.id, email: user.email, role, organisation: { id: organisation.id, name: organisation.name } }];
    }],

    ['POST', '/auth/login', ({ body }) => {
      const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
      const nowMs = now().getTime();
      const attempts = (loginAttempts.get(email) || []).filter((t) => nowMs - t < LOGIN_WINDOW_MS);
      if (attempts.length >= LOGIN_LIMIT) fail(429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.');
      const user = db.users.find((u) => u.emailNormalized === email);
      if (!user || typeof body?.password !== 'string' || user.password !== body.password) {
        loginAttempts.set(email, [...attempts, nowMs]);
        fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      loginAttempts.delete(email);
      if (user.deactivatedAt) fail(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated. Contact a workspace admin.');
      return [200, { ...issueToken(user), user: userDto(user, { withOrganisation: true }) }];
    }],

    ['GET', '/auth/me', ({ user }) => [200, userDto(user, { withOrganisation: true })]],

    ['PATCH', '/users/me', ({ user, body }) => {
      const name = str(body, 'name', { required: false, max: LIMITS.nameMax, label: 'Name' });
      if (body?.newPassword !== undefined) {
        if (typeof body.currentPassword !== 'string' || body.currentPassword !== user.password) {
          badRequest('Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
        }
        user.password = passwordRule(body.newPassword, 'newPassword');
        // Revokes every earlier session, like the API's tokenVersion.
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      }
      if (name) user.name = name;
      user.updatedAt = stamp();
      return [200, body?.newPassword !== undefined ? { ...userDto(user, { withOrganisation: true }), ...issueToken(user) } : userDto(user, { withOrganisation: true })];
    }],

    // Admin user management (SRS §2.2).
    ['GET', '/users', ({ user, query }) => {
      if (!isAdmin(user)) forbidden('Only an admin can manage user accounts.');
      const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 50));
      const role = query.role ? oneOf(query, 'role', ROLES, { label: 'Role' }) : undefined;
      const status = query.status ? oneOf(query, 'status', ['active', 'deactivated'], { label: 'Status' }) : undefined;
      const needle = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
      const people = db.users.filter((u) => sameOrg(user, u));
      const matches = people
        .filter((u) => !status || (status === 'active') === !u.deactivatedAt)
        .filter((u) => (!role || u.role === role) && (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id));
      const items = matches.slice((page - 1) * pageSize, page * pageSize).map((u) => ({
        ...userDto(u),
        projectCount: db.projects.filter((p) => p.memberIds.includes(u.id)).length,
      }));
      const roleCounts = Object.fromEntries(ROLES.map((r) => [r, people.filter((u) => u.role === r).length]));
      const deactivatedCount = people.filter((u) => u.deactivatedAt).length;
      return [200, { items, page, pageSize, total: matches.length, roleCounts, deactivatedCount }];
    }],

    ['PATCH', '/users/:userId/role', ({ user, params, body }) => {
      if (!isAdmin(user)) forbidden('Only an admin can manage user accounts.');
      idParam(params.userId, 'user');
      const role = oneOf(body, 'role', ROLES, { label: 'Role' });
      const target = findUser(params.userId);
      if (!target || !sameOrg(user, target)) notFound('User');
      if (target.role === 'Admin' && role !== 'Admin' && db.users.filter((u) => sameOrg(user, u) && u.role === 'Admin' && !u.deactivatedAt && u.id !== target.id).length === 0) {
        fail(409, 'LAST_ADMIN', 'The organisation needs at least one admin. Promote someone else first.');
      }
      if (target.role !== role) {
        target.role = role;
        target.updatedAt = stamp();
      }
      return [200, userDto(target)];
    }],

    ['PATCH', '/users/:userId/status', ({ user, params, body }) => {
      if (!isAdmin(user)) forbidden('Only an admin can manage user accounts.');
      idParam(params.userId, 'user');
      if (typeof body?.active !== 'boolean') badRequest('Send active as true or false.', { active: 'Must be true or false.' });
      if (params.userId === user.id && !body.active) badRequest('You cannot deactivate your own account.');
      const target = findUser(params.userId);
      if (!target || !sameOrg(user, target)) notFound('User');
      if (!target.deactivatedAt !== body.active) {
        target.deactivatedAt = body.active ? null : stamp();
        if (!body.active) target.tokenVersion = (target.tokenVersion ?? 0) + 1;
        target.updatedAt = stamp();
      }
      return [200, userDto(target)];
    }],

    ['GET', '/projects', ({ user }) => {
      const list = db.projects.filter((p) => sameOrg(user, p) && isMember(user, p)).map(projectDto);
      return [200, list];
    }],

    ['GET', '/dashboard', ({ user, query }) => {
      const today = resolveToday(query.today, now());
      const weekEnd = new Date(Date.parse(today + 'T00:00:00.000Z') + 7 * 86400000).toISOString().slice(0, 10);
      const projects = db.projects.filter((project) => sameOrg(user, project) && isMember(user, project));
      const projectIds = new Set(projects.map((project) => project.id));
      const visibleTasks = db.tasks.filter((task) => projectIds.has(task.projectId));
      const summaries = projects.map((project) => {
        const tasks = visibleTasks.filter((task) => task.projectId === project.id);
        const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, tasks.filter((task) => task.status === status).length]));
        return { projectId: project.id, total: tasks.length, counts, overdue: tasks.filter((task) => isOverdue(task, today)).length };
      });
      const assigned = visibleTasks.filter((task) => task.assigneeIds.includes(user.id));
      const open = assigned.filter((task) => task.status !== 'Done');
      const stats = { openAssigned: open.length, completed: assigned.length - open.length, overdue: open.filter((task) => isOverdue(task, today)).length, dueIn7Days: open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= weekEnd).length };
      const myTasks = open.sort((a, b) => Number(!a.dueDate) - Number(!b.dueDate) || (a.dueDate || '').localeCompare(b.dueDate || '') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 500);
      return [200, { projects: summaries, myTasks: myTasks.map(taskDto), stats }];
    }],

    // Workspace settings: everyone reads them; only Admins change them.
    ['GET', '/settings', ({ user }) => [200, settings(user)]],

    ['PATCH', '/settings', ({ user, body }) => {
      if (!isAdmin(user)) forbidden('Only an admin can change workspace settings.');
      const projectCreation = oneOf(body, 'projectCreation', PROJECT_CREATION, { label: 'Project creation' });
      orgOf(user).projectCreation = projectCreation;
      return [200, settings(user)];
    }],

    // The organisation page: who it is and how its projects are doing. The invite code is for Admins only.
    ['GET', '/organisation', ({ user }) => [200, organisationDto(user)]],

    ['PATCH', '/organisation', ({ user, body }) => {
      if (!isAdmin(user)) forbidden('Only an admin can edit the organisation.');
      const name = str(body, 'name', { max: ORGANISATION_NAME_MAX, label: 'Organisation name' });
      const organisation = orgOf(user);
      organisation.name = name;
      organisation.updatedAt = stamp();
      return [200, organisationDto(user)];
    }],

    // Rotating ends the old code at once; people already in are unaffected.
    ['POST', '/organisation/join-code', ({ user }) => {
      if (!isAdmin(user)) forbidden('Only an admin can change the invite code.');
      const organisation = orgOf(user);
      organisation.joinCode = freshJoinCode();
      organisation.updatedAt = stamp();
      return [200, organisationDto(user)];
    }],

    ['GET', '/auth/invitations/:token', ({ params }) => {
      const { invitation, organisation } = usableInvitation(params.token);
      return [200, { email: invitation.email, expiresAt: invitation.expiresAt, organisation: { id: organisation.id, name: organisation.name } }];
    }],

    ['GET', '/organisation/invitations', ({ user }) => {
      if (!isAdmin(user)) forbidden('Only an admin can see invitation links.');
      const rows = invitationList().filter((item) => sameOrg(user, item))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, INVITATION_LIST_LIMIT);
      return [200, rows.map(invitationDto)];
    }],

    ['POST', '/organisation/invitations', ({ user, body }) => {
      if (!isAdmin(user)) forbidden('Only an admin can create invitation links.');
      const email = str(body, 'email', { max: 254, label: 'Email' });
      if (!EMAIL_RE.test(email)) badRequest('Enter a valid email address.', { email: 'Enter a valid email address.' });
      const emailNormalized = normalizeEmail(email);
      if (db.users.some((u) => u.emailNormalized === emailNormalized)) {
        fail(409, 'DUPLICATE_EMAIL', 'There is already an account with this email.', { email: 'There is already an account with this email. Add them to projects from the project members page.' });
      }
      const at = stamp();
      for (const item of invitationList()) {
        if (sameOrg(user, item) && item.emailNormalized === emailNormalized && invitationState(item, now()) === 'pending') item.revokedAt = at;
      }
      const token = generateInvitationToken();
      const invitation = { id: nextId('invitation'), organisationId: user.organisationId, email, emailNormalized, token, createdById: user.id, expiresAt: invitationExpiry(now()).toISOString(), acceptedAt: null, acceptedById: null, revokedAt: null, createdAt: at, updatedAt: at };
      invitationList().push(invitation);
      return [201, { ...invitationDto(invitation), token, path: invitationPath(token) }];
    }],

    ['DELETE', '/organisation/invitations/:invitationId', ({ user, params }) => {
      if (!isAdmin(user)) forbidden('Only an admin can revoke invitation links.');
      const invitation = invitationList().find((item) => item.id === params.invitationId && sameOrg(user, item));
      if (!invitation) notFound('Invitation');
      if (invitation.acceptedAt) fail(409, 'INVITATION_USED', 'This invitation has already been used, so there is nothing to revoke.');
      invitation.revokedAt ??= stamp();
      return [200, invitationDto(invitation)];
    }],

    ['GET', '/organisation/overview', ({ user, query }) => {
      const today = resolveToday(query.today, now());
      const admin = isAdmin(user);
      const rows = db.projects
        .filter((p) => sameOrg(user, p) && (admin || p.memberIds.includes(user.id) || p.visibility === 'open'))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .slice(0, 200)
        .map((p) => {
          const tasks = db.tasks.filter((t) => t.projectId === p.id);
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            visibility: p.visibility ?? 'private',
            ownerName: findUser(p.ownerId)?.name ?? null,
            memberCount: p.memberIds.length,
            yourRole: projectRoleOf(p, user.id),
            updatedAt: p.updatedAt,
            total: tasks.length,
            counts: Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])),
            overdue: tasks.filter((t) => isOverdue(t, today)).length,
          };
        });
      const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
      return [200, {
        projects: rows,
        totals: {
          people: memberCount(user),
          projects: rows.length,
          tasks: sum((row) => row.total),
          done: sum((row) => row.counts.Done),
          overdue: sum((row) => row.overdue),
        },
      }];
    }],

    // Open projects the caller is not in yet. Private projects never appear.
    ['GET', '/projects/directory', ({ user, query }) => {
      const needle = typeof query.q === 'string' ? query.q.trim().slice(0, 80).toLowerCase() : '';
      const list = db.projects
        .filter((p) => sameOrg(user, p) && p.visibility === 'open' && !p.memberIds.includes(user.id))
        .filter((p) => !needle || p.name.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .slice(0, 50)
        .map((p) => ({ id: p.id, name: p.name, key: p.key ?? null, description: p.description, ownerName: findUser(p.ownerId)?.name ?? null, memberCount: p.memberIds.length }));
      return [200, list];
    }],

    // A free key for a new project, suggested from its name.
    ['GET', '/projects/key-suggestion', ({ user, query }) => {
      const name = typeof query.name === 'string' ? query.name.slice(0, 80) : '';
      return [200, { key: suggestProjectKey(name, takenKeys(user)) }];
    }],

    ['POST', '/projects', ({ user, body }) => {
      if (!canCreateProject(user, settings(user))) forbidden('In this workspace only leads and admins can create projects. Ask an admin, or join an open project.');
      const name = str(body, 'name', { max: LIMITS.projectNameMax, label: 'Project name' });
      const description = str(body, 'description', { required: false, max: LIMITS.descriptionMax, label: 'Description' }) || '';
      const visibility = oneOf(body, 'visibility', PROJECT_VISIBILITIES, { required: false, label: 'Visibility' }) ?? 'private';
      const requested = body?.key === undefined || body?.key === null || body?.key === '' ? undefined : readKey(body);
      const taken = takenKeys(user);
      if (requested && taken.has(requested)) keyTaken();
      const key = requested ?? suggestProjectKey(name, taken);
      const at = stamp();
      const project = { id: nextId('project'), organisationId: user.organisationId, name, description, key, previousKeys: [], taskCounter: 0, visibility, ownerId: user.id, memberIds: [user.id], managerIds: [], viewerIds: [], createdAt: at, updatedAt: at };
      db.projects.push(project);
      return [201, projectDto(project)];
    }],

    // Anyone may join an open project as a Member; joining twice is harmless.
    ['POST', '/projects/:projectId/join', ({ user, params }) => {
      idParam(params.projectId, 'project');
      const project = db.projects.find((p) => p.id === params.projectId);
      if (!project || !sameOrg(user, project)) notFound('Project');
      const alreadyMember = project.memberIds.includes(user.id);
      if (!alreadyMember && project.visibility !== 'open') forbidden('This project is private. Ask its owner or a manager to add you.');
      if (!alreadyMember) {
        project.memberIds.push(user.id);
        project.updatedAt = stamp();
      }
      return [alreadyMember ? 200 : 201, projectDto(project)];
    }],

    ['GET', '/projects/:projectId', ({ user, params }) => [200, projectDto(projectFor(user, params.projectId))]],

    ['PATCH', '/projects/:projectId', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { action: 'project.edit' });
      const name = str(body, 'name', { required: false, max: LIMITS.projectNameMax, label: 'Project name' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' });
      const visibility = oneOf(body, 'visibility', PROJECT_VISIBILITIES, { required: false, label: 'Visibility' });
      const key = body?.key === undefined ? undefined : readKey(body);
      if (!['name', 'description', 'visibility', 'key'].some((field) => body?.[field] !== undefined)) badRequest('Provide a project field to update.');
      if (key !== undefined && key !== project.key) {
        if (!can(user, 'project.key', project)) forbidden(FORBIDDEN['project.key']);
        if (takenKeys(user, project.id).has(key)) keyTaken();
        const previous = new Set(project.previousKeys ?? []);
        if (project.key) previous.add(project.key);
        previous.delete(key);
        project.key = key;
        project.previousKeys = [...previous];
      }
      if (name) project.name = name;
      if (description !== undefined) project.description = description;
      if (visibility) project.visibility = visibility;
      project.updatedAt = stamp();
      return [200, projectDto(project)];
    }],

    ['DELETE', '/projects/:projectId', ({ user, params }) => {
      const project = projectFor(user, params.projectId, { action: 'project.delete' });
      db.tasks.filter((t) => t.projectId === project.id).forEach((t) => removeTaskCascade(t.id));
      db.sprints = sprintList().filter((sprint) => sprint.projectId !== project.id);
      db.projects = db.projects.filter((p) => p.id !== project.id);
      return [204, null];
    }],

    ['GET', '/projects/:projectId/members', ({ user, params }) => [200, projectDto(projectFor(user, params.projectId)).members]],

    ['POST', '/projects/:projectId/members', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { action: 'members.manage' });
      const email = str(body, 'email', { max: 254, label: 'Email' });
      const role = body?.role === undefined ? 'Member' : oneOf(body, 'role', GRANTABLE_PROJECT_ROLES, { label: 'Project role' });
      if (!rolesForNewMember(user, project).includes(role)) forbidden('Only the project owner or an admin can add a manager.');
      // Only people in this organisation; an email registered elsewhere looks unregistered.
      const member = db.users.find((u) => u.emailNormalized === normalizeEmail(email) && sameOrg(user, u));
      if (!member) fail(404, 'NOT_FOUND', 'Nobody in your organisation has that email.', { email: 'Email is not registered in your organisation.' });
      if (member.deactivatedAt) badRequest('That account is deactivated.', { email: 'This account is deactivated.' });
      if (!project.memberIds.includes(member.id)) {
        Object.assign(project, withMemberRole(project, member.id, role));
        project.updatedAt = stamp();
      }
      return [200, members(project)];
    }],

    ['PATCH', '/projects/:projectId/members/:userId', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { action: 'members.manage' });
      idParam(params.userId, 'user');
      const role = oneOf(body, 'role', PROJECT_ROLES, { label: 'Project role' });
      const current = projectRoleOf(project, params.userId);
      if (!current) notFound('Member');
      if (current !== role) {
        const reason = memberRoleChangeError(user, project, params.userId, role);
        if (reason) (current === 'Owner' ? badRequest : forbidden)(reason);
        if (role === 'Owner' && findUser(params.userId)?.deactivatedAt) badRequest('Ownership cannot go to a deactivated account.');
        Object.assign(project, withMemberRole(project, params.userId, role));
        if (role === 'Viewer') {
          db.tasks
            .filter((t) => t.projectId === project.id && t.assigneeIds.includes(params.userId))
            .forEach((t) => {
              t.assigneeIds = t.assigneeIds.filter((id) => id !== params.userId);
              record(t, user, [{ action: 'assignees', details: { added: [], removed: [params.userId] } }]);
            });
        }
        project.updatedAt = stamp();
      }
      return [200, members(project)];
    }],

    ['DELETE', '/projects/:projectId/members/:userId', ({ user, params }) => {
      const project = projectFor(user, params.projectId);
      idParam(params.userId, 'user');
      const current = projectRoleOf(project, params.userId);
      if (!current) notFound('Member');
      const reason = memberRemovalError(user, project, params.userId);
      if (reason) (current === 'Owner' ? badRequest : forbidden)(reason);
      Object.assign(project, withoutMember(project, params.userId));
      // Removing a member also unassigns them so no task points at a non-member, and drops their
      // notifications for the project (they name tasks the user can no longer open).
      const projectTaskIds = new Set();
      db.tasks
        .filter((t) => t.projectId === project.id)
        .forEach((t) => {
          projectTaskIds.add(t.id);
          if (t.assigneeIds.includes(params.userId)) {
            t.assigneeIds = t.assigneeIds.filter((id) => id !== params.userId);
            record(t, user, [{ action: 'assignees', details: { added: [], removed: [params.userId] } }]);
          }
        });
      db.notifications = db.notifications.filter((n) => !(n.userId === params.userId && projectTaskIds.has(n.taskId)));
      project.updatedAt = stamp();
      return [200, members(project)];
    }],

    ['GET', '/projects/:projectId/tasks', ({ user, params, query }) => {
      const project = projectFor(user, params.projectId);
      const filters = readFilters(query);
      return [200, db.tasks.filter((t) => t.projectId === project.id && (matchesFilters(t, filters) || (matchesFilters(t, { ...filters, q: '' }) && keyMatch(t, filters, [project])))).map(taskDto)];
    }],

    ['POST', '/projects/:projectId/tasks', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { action: 'task.create' });
      const title = str(body, 'title', { max: LIMITS.taskTitleMax, label: 'Title' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' }) || '';
      const status = oneOf(body, 'status', TASK_STATUSES, { required: false, label: 'Status' }) || 'To Do';
      const priority = oneOf(body, 'priority', TASK_PRIORITIES, { required: false, label: 'Priority' }) || 'Medium';
      const dueDate = dateOnly(body, 'dueDate', { label: 'Due date' });
      const assigneeIds = validateAssignees(body, project) || [];
      const workItem = readWorkItem(body, { create: true });
      checkEpicRules({ next: { ...workItem, projectId: project.id } });
      const at = stamp();
      ensureRanks(project.id);
      const rank = nextRank(db.tasks.filter((t) => t.projectId === project.id));
      const task = { id: nextId('task'), title, description, status, priority, dueDate, projectId: project.id, number: nextTaskNumber(project), ...workItem, sprintId: null, rank, assigneeIds, completedAt: status === 'Done' ? at : null, checklist: [], createdAt: at, updatedAt: at };
      db.tasks.push(task);
      record(task, user, [{ action: 'created', details: { title: task.title, type: task.type } }]);
      notifyAssignment(task, assigneeIds, user);
      return [201, taskDto(task)];
    }],

    ['GET', '/tasks', ({ user, query }) => {
      const filters = readFilters(query);
      const projects = db.projects.filter((p) => sameOrg(user, p) && isMember(user, p));
      const visible = db.tasks.filter((t) => {
        if (!projects.some((p) => p.id === t.projectId)) return false;
        if (filters.projectId && t.projectId !== filters.projectId) return false;
        return matchesFilters(t, filters) || (matchesFilters(t, { ...filters, q: '' }) && keyMatch(t, filters, projects));
      });
      return [200, visible.map(taskDto)];
    }],

    // Opens a task by its key; a key the project used before still resolves.
    ['GET', '/tasks/by-key/:key', ({ user, params }) => {
      const parsed = parseTaskKey(params.key);
      if (!parsed) fail(404, 'NOT_FOUND', 'No task has that key.');
      const candidates = db.projects.filter((p) => sameOrg(user, p) && projectAnswersToKey(p, parsed.projectKey));
      const match = candidates.find((p) => p.key === parsed.projectKey) ?? candidates[0];
      const task = match && db.tasks.find((t) => t.projectId === match.id && t.number === parsed.number);
      if (!task) fail(404, 'NOT_FOUND', 'No task has that key.');
      projectFor(user, match.id);
      return [200, taskDto(task)];
    }],

    // Who changed what on a task, newest first (issue #75).
    ['GET', '/tasks/:taskId/activity', ({ user, params, query }) => {
      const { task } = taskFor(user, params.taskId);
      const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '50', 10) || 50));
      const all = (db.activities ?? [])
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.taskId === task.id)
        .sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt) || b.index - a.index)
        .map(({ entry }) => entry);
      const items = all.slice((page - 1) * pageSize, page * pageSize).map((entry) => {
        const actor = findUser(entry.actorId);
        return { ...clone(entry), actor: actor ? { id: actor.id, name: actor.name } : null };
      });
      return [200, { items, page, pageSize, total: all.length }];
    }],

    ['GET', '/tasks/:taskId', ({ user, params }) => [200, taskDto(taskFor(user, params.taskId).task)]],

    ['PATCH', '/tasks/:taskId', ({ user, params, body }) => {
      const { task, project } = taskFor(user, params.taskId, { action: 'task.edit' });
      const title = str(body, 'title', { required: false, max: LIMITS.taskTitleMax, label: 'Title' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' });
      const status = oneOf(body, 'status', TASK_STATUSES, { required: false, label: 'Status' });
      const priority = oneOf(body, 'priority', TASK_PRIORITIES, { required: false, label: 'Priority' });
      const dueDate = body && 'dueDate' in body ? dateOnly(body, 'dueDate', { label: 'Due date' }) : undefined;
      const assigneeIds = validateAssignees(body, project);
      const workItem = readWorkItem(body);
      if (workItem.type !== undefined || workItem.epicId !== undefined) {
        const current = { id: task.id, type: task.type ?? 'Task', epicId: task.epicId ?? null };
        checkEpicRules({
          current,
          next: { id: task.id, projectId: project.id, type: workItem.type ?? current.type, epicId: workItem.epicId !== undefined ? workItem.epicId : current.epicId },
        });
      }
      const before = taskSnapshot(task);
      Object.assign(task, workItem);
      if (title) task.title = title;
      if (description !== undefined) task.description = description;
      if (status) applyStatus(task, status);
      if (priority) task.priority = priority;
      if (dueDate !== undefined) task.dueDate = dueDate;
      if (assigneeIds) {
        const added = assigneeIds.filter((id) => !task.assigneeIds.includes(id));
        task.assigneeIds = assigneeIds;
        notifyAssignment(task, added, user);
      }
      record(task, user, taskChangeActivities(before, taskSnapshot(task)));
      releaseFromCompletedSprint(task, before.status, user);
      task.updatedAt = stamp();
      return [200, taskDto(task)];
    }],

    ['DELETE', '/tasks/:taskId', ({ user, params }) => {
      const { task } = taskFor(user, params.taskId, { action: 'task.delete' });
      removeTaskCascade(task.id);
      return [204, null];
    }],

    // Owners, managers and members may move a task between columns (SRS §2.2 "update permitted
    // task status"); viewers are read-only.
    ['PATCH', '/tasks/:taskId/status', ({ user, params, body }) => {
      const { task } = taskFor(user, params.taskId, { action: 'task.status' });
      const from = task.status;
      applyStatus(task, oneOf(body, 'status', TASK_STATUSES, { label: 'Status' }));
      if (task.status !== from) record(task, user, [{ action: 'status', details: { from, to: task.status } }]);
      releaseFromCompletedSprint(task, from, user);
      task.updatedAt = stamp();
      return [200, { taskId: task.id, status: task.status, completedAt: task.completedAt ?? null, sprintId: task.sprintId ?? null, updatedAt: task.updatedAt }];
    }],

    // ---------- backlog and sprints (issue #76) ----------
    ['GET', '/projects/:projectId/sprints', ({ user, params }) => {
      const project = projectFor(user, params.projectId);
      return [200, sprintList().filter((sprint) => sprint.projectId === project.id).sort((a, b) => a.number - b.number).map(sprintDto)];
    }],

    ['GET', '/sprints/:sprintId/report', ({ user, params }) => {
      const { sprint, project } = sprintFor(user, params.sprintId);
      return [200, buildSprintReport({
        sprint: sprintDto(sprint),
        tasks: db.tasks.filter((t) => t.projectId === project.id),
        activities: (db.activities ?? []).filter((entry) => entry.projectId === project.id),
        today: stamp().slice(0, 10),
      })];
    }],

    ['POST', '/projects/:projectId/sprints', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { action: 'sprint.manage' });
      const values = readSprint(body, { create: true });
      const existing = sprintList().filter((sprint) => sprint.projectId === project.id);
      project.sprintCounter = Math.max((project.sprintCounter ?? 0) + 1, ...existing.map((sprint) => sprint.number + 1));
      const number = project.sprintCounter;
      const at = stamp();
      const sprint = {
        id: nextId('sprint'), projectId: project.id, number, name: values.name ?? sprintName({ projectKey: project.key, projectName: project.name, number }),
        goal: values.goal ?? '', startDate: values.startDate, endDate: values.endDate, state: 'planned',
        startedAt: null, completedAt: null, committed: null, report: null, createdAt: at, updatedAt: at,
      };
      sprintList().push(sprint);
      return [201, sprintDto(sprint)];
    }],

    ['PATCH', '/sprints/:sprintId', ({ user, params, body }) => {
      const { sprint } = sprintFor(user, params.sprintId, { action: 'sprint.manage' });
      if (sprint.state === 'completed') fail(409, 'SPRINT_COMPLETED', 'A completed sprint is a record and cannot be changed.');
      const values = readSprint(body, { current: sprint });
      if (Object.keys(values).length === 0) badRequest('Provide a name, goal, start date or end date to update.');
      Object.assign(sprint, values, { updatedAt: stamp() });
      return [200, sprintDto(sprint)];
    }],

    ['DELETE', '/sprints/:sprintId', ({ user, params }) => {
      const { sprint } = sprintFor(user, params.sprintId, { action: 'sprint.manage' });
      if (sprint.state !== 'planned') fail(409, 'SPRINT_NOT_PLANNED', 'Only a planned sprint can be deleted. Complete an active sprint instead.');
      moveToSprint(db.tasks.filter((t) => t.sprintId === sprint.id), null, user);
      db.sprints = sprintList().filter((item) => item.id !== sprint.id);
      return [204, null];
    }],

    ['POST', '/sprints/:sprintId/start', ({ user, params }) => {
      const { sprint, project } = sprintFor(user, params.sprintId, { action: 'sprint.manage' });
      if (sprint.state !== 'planned') fail(409, 'SPRINT_NOT_PLANNED', sprint.state === 'active' ? 'This sprint has already started.' : 'This sprint is complete.');
      const active = sprintList().find((item) => item.projectId === project.id && item.state === 'active');
      if (active) fail(409, 'ACTIVE_SPRINT_EXISTS', `Complete "${active.name}" before starting another sprint. A project runs one sprint at a time.`);
      Object.assign(sprint, { state: 'active', startedAt: stamp(), committed: commitmentOf(db.tasks.filter((t) => t.sprintId === sprint.id)), updatedAt: stamp() });
      return [200, sprintDto(sprint)];
    }],

    ['POST', '/sprints/:sprintId/complete', ({ user, params, body }) => {
      const { sprint, project } = sprintFor(user, params.sprintId, { action: 'sprint.manage' });
      if (sprint.state !== 'active') fail(409, 'SPRINT_NOT_ACTIVE', sprint.state === 'planned' ? 'Start this sprint before completing it.' : 'This sprint is already complete.');
      let moveTo = null;
      if (body?.moveTo != null && body.moveTo !== 'backlog') {
        idParam(body.moveTo, 'sprint');
        const target = sprintList().find((item) => item.id === body.moveTo);
        const problem = target?.state === 'active' ? 'Choose a planned sprint or the backlog.' : sprintTargetError(target, project.id);
        if (problem) badRequest(problem, { moveTo: problem });
        moveTo = target.id;
      }
      const tasks = db.tasks.filter((t) => t.sprintId === sprint.id);
      const plan = completionPlan(tasks, moveTo);
      moveToSprint(tasks.filter((t) => plan.moveIds.includes(t.id)), moveTo, user);
      Object.assign(sprint, { state: 'completed', completedAt: stamp(), report: plan.report, updatedAt: stamp() });
      return [200, sprintDto(sprint)];
    }],

    ['POST', '/tasks/:taskId/move', ({ user, params, body }) => {
      const { task, project } = taskFor(user, params.taskId, { action: 'task.edit' });
      if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Request body must be an object.');
      const from = task.sprintId ?? null;
      let to = from;
      if (body.sprintId !== undefined) {
        to = body.sprintId === null ? null : idParam(body.sprintId, 'sprint');
        if (to) {
          const problem = sprintTargetError(sprintList().find((item) => item.id === to), project.id);
          if (problem) badRequest(problem, { sprintId: problem });
        }
      }
      if (from !== to && from && task.status === 'Done' && sprintList().find((item) => item.id === from)?.state === 'completed') {
        badRequest('Finished work stays with the completed sprint it was done in.', { sprintId: 'Finished in a completed sprint.' });
      }
      const neighbourIds = {};
      for (const key of ['previousId', 'nextId']) {
        if (body[key] == null) continue;
        neighbourIds[key] = idParam(body[key], 'task');
        if (neighbourIds[key] === task.id) badRequest('Place the task next to another task.', { [key]: 'Choose another task.' });
      }
      if (Object.keys(neighbourIds).length > 0) {
        ensureRanks(project.id);
        const place = () => {
          const rankOf = (id) => {
            if (!id) return null;
            const found = db.tasks.find((t) => t.id === id && t.projectId === project.id);
            if (!found) badRequest('Place the task next to tasks from this project.');
            return found.rank;
          };
          return rankBetween(rankOf(neighbourIds.previousId), rankOf(neighbourIds.nextId));
        };
        let placed = place();
        if (placed.crowded) {
          ensureRanks(project.id, { force: true });
          placed = place();
        }
        task.rank = placed.rank;
      }
      if (from !== to) moveToSprint([task], to, user);
      return [200, taskDto(task)];
    }],

    // Checklist items: ticking is progress (task.status); adding, renaming, removing is editing.
    ['POST', '/tasks/:taskId/checklist', ({ user, params, body }) => {
      const { task } = taskFor(user, params.taskId, { action: 'task.edit' });
      const text = str(body, 'text', { max: LIMITS.checklistItemMax, label: 'Checklist item' });
      task.checklist ??= [];
      if (task.checklist.length >= LIMITS.checklistItems) {
        badRequest(`A task can have at most ${LIMITS.checklistItems} checklist items.`, { text: `A task can have at most ${LIMITS.checklistItems} checklist items.` });
      }
      task.checklist.push({ id: nextId('check'), text, done: false });
      record(task, user, [{ action: 'checklist.add', details: { text } }]);
      task.updatedAt = stamp();
      return [201, { taskId: task.id, checklist: clone(task.checklist), updatedAt: task.updatedAt }];
    }],

    ['PATCH', '/tasks/:taskId/checklist/:itemId', ({ user, params, body }) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('Send a JSON object.');
      if (body.done !== undefined && typeof body.done !== 'boolean') badRequest('Done must be true or false.', { done: 'Done must be true or false.' });
      if (body.done === undefined && body.text === undefined) badRequest('Provide done or text to update.');
      const text = body.text !== undefined ? str(body, 'text', { max: LIMITS.checklistItemMax, label: 'Checklist item' }) : undefined;
      const { task } = taskFor(user, params.taskId, { action: text !== undefined ? 'task.edit' : 'task.status' });
      const item = (task.checklist || []).find((entry) => entry.id === params.itemId);
      if (!item) notFound('Checklist item');
      const entries = [];
      if (body.done !== undefined && body.done !== item.done) entries.push({ action: 'checklist.check', details: { text: text ?? item.text, done: body.done } });
      if (text !== undefined && text !== item.text) entries.push({ action: 'checklist.rename', details: { from: item.text, to: text } });
      record(task, user, entries);
      if (body.done !== undefined) item.done = body.done;
      if (text !== undefined) item.text = text;
      task.updatedAt = stamp();
      return [200, { taskId: task.id, checklist: clone(task.checklist), updatedAt: task.updatedAt }];
    }],

    ['DELETE', '/tasks/:taskId/checklist/:itemId', ({ user, params }) => {
      const { task } = taskFor(user, params.taskId, { action: 'task.edit' });
      const index = (task.checklist || []).findIndex((entry) => entry.id === params.itemId);
      if (index < 0) notFound('Checklist item');
      record(task, user, [{ action: 'checklist.remove', details: { text: task.checklist[index].text } }]);
      task.checklist.splice(index, 1);
      task.updatedAt = stamp();
      return [200, { taskId: task.id, checklist: clone(task.checklist), updatedAt: task.updatedAt }];
    }],

    ['GET', '/tasks/:taskId/comments', ({ user, params }) => {
      const { task } = taskFor(user, params.taskId);
      const list = db.comments
        .filter((c) => c.taskId === task.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => ({ ...clone(c), author: findUser(c.authorId) ? memberDto(findUser(c.authorId)) : null }));
      return [200, list];
    }],

    ['POST', '/tasks/:taskId/comments', ({ user, params, body }) => {
      const { task } = taskFor(user, params.taskId, { action: 'comment.create' });
      const text = str(body, 'text', { max: LIMITS.commentMax, label: 'Comment' });
      const comment = { id: nextId('comment'), taskId: task.id, authorId: user.id, text, createdAt: stamp() };
      db.comments.push(comment);
      record(task, user, [{ action: 'comment.add', details: { commentId: comment.id, excerpt: commentExcerpt(text) } }]);
      return [201, { ...clone(comment), author: memberDto(user) }];
    }],

    ['DELETE', '/tasks/:taskId/comments/:commentId', ({ user, params }) => {
      const { task, project } = taskFor(user, params.taskId);
      idParam(params.commentId, 'comment');
      const index = db.comments.findIndex((comment) => comment.id === params.commentId && comment.taskId === task.id);
      if (index < 0) notFound('Comment');
      const comment = db.comments[index];
      if (comment.authorId !== user.id && !can(user, 'comment.moderate', project)) forbidden('You cannot delete this comment.');
      db.comments.splice(index, 1);
      // The history keeps that a comment was made, but not the text of one that was deleted.
      (db.activities ?? []).forEach((a) => {
        if (a.taskId === task.id && a.action === 'comment.add' && a.details?.commentId === comment.id) a.details = { ...a.details, excerpt: null };
      });
      record(task, user, [{ action: 'comment.delete', details: { commentId: comment.id } }]);
      return [204, null];
    }],

    ['GET', '/notifications/unread-count', ({ user }) => { maybeGenerateDueReminders(user); return [200, { unreadCount: db.notifications.filter((n) => n.userId === user.id && !n.read).length }]; }],
    ['GET', '/notifications', ({ user, query }) => {
      maybeGenerateDueReminders(user);
      const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 50));
      const own = db.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const items = own.slice((page - 1) * pageSize, page * pageSize).map((n) => {
        const { dedupeKey: _dedupeKey, ...rest } = n;
        const task = db.tasks.find((t) => t.id === n.taskId);
        return { ...clone(rest), projectId: task?.projectId ?? null };
      });
      return [200, { items, page, pageSize, total: own.length, unreadCount: own.filter((n) => !n.read).length }];
    }],

    ['PATCH', '/notifications/:notificationId/read', ({ user, params }) => {
      idParam(params.notificationId, 'notification');
      const notification = db.notifications.find((n) => n.id === params.notificationId);
      // Recipient isolation: another user's notification looks like it does not exist.
      if (!notification || notification.userId !== user.id) notFound('Notification');
      notification.read = true;
      const { dedupeKey: _dedupeKey, ...rest } = notification;
      return [200, clone(rest)];
    }],

    ['PATCH', '/notifications/read-all', ({ user }) => {
      let updated = 0;
      for (const notification of db.notifications) {
        if (notification.userId === user.id && !notification.read) {
          notification.read = true;
          updated += 1;
        }
      }
      return [200, { updated }];
    }],

    ['GET', '/projects/:projectId/summary', ({ user, params, query }) => {
      const today = resolveToday(query.today, now());
      const project = projectFor(user, params.projectId);
      const tasks = db.tasks.filter((t) => t.projectId === project.id);
      const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
      return [200, { projectId: project.id, total: tasks.length, counts, overdue: tasks.filter((task) => isOverdue(task, today)).length }];
    }],

    ['GET', '/projects/:projectId/tasks/export.csv', ({ user, params, query }) => {
      const project = projectFor(user, params.projectId);
      const filters = readFilters(query);
      const rows = db.tasks
        .filter((t) => t.projectId === project.id && (matchesFilters(t, filters) || (matchesFilters(t, { ...filters, q: '' }) && keyMatch(t, filters, [project]))))
        .map((t) => ({
          id: t.id,
          key: taskKeyOf(t) ?? '',
          type: t.type ?? 'Task',
          title: t.title,
          status: t.status,
          priority: t.priority,
          storyPoints: t.storyPoints ?? '',
          labels: (t.labels ?? []).join('; '),
          epic: t.epicId ? taskKeyOf(db.tasks.find((e) => e.id === t.epicId) ?? {}) ?? '' : '',
          dueDate: t.dueDate || '',
          assignees: t.assigneeIds.map((id) => findUser(id)?.name || id).join('; '),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));
      const headers = ['id', 'key', 'type', 'title', 'status', 'priority', 'storyPoints', 'labels', 'epic', 'dueDate', 'assignees', 'createdAt', 'updatedAt'];
      return [200, toCsv(headers, rows), { 'content-type': 'text/csv; charset=utf-8' }];
    }],
  ];

  const PUBLIC = new Set(['POST /auth/register', 'POST /auth/login', 'GET /auth/invitations/:token']);
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys = [];
    const regex = new RegExp(
      `^${pattern.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })}$`,
    );
    return { method, pattern, regex, keys, handler };
  });

  /**
   * Handles one request. Always resolves; errors come back as envelope responses.
   * @returns {{ status: number, data: any, headers: Record<string, string> }}
   */
  function handle(method, path, { body, token, query = {} } = {}) {
    try {
      const routeMatch = compiled.find((r) => r.method === method && r.regex.test(path));
      if (!routeMatch) {
        const pathExists = compiled.some((r) => r.regex.test(path));
        fail(pathExists ? 405 : 404, pathExists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', 'Endpoint not found.');
      }
      const values = path.match(routeMatch.regex).slice(1).map(decodeURIComponent);
      const params = Object.fromEntries(routeMatch.keys.map((key, i) => [key, values[i]]));
      const user = PUBLIC.has(`${method} ${routeMatch.pattern}`) ? null : authenticate(token);
      const [status, data, headers = { 'content-type': 'application/json' }] = routeMatch.handler({
        user,
        params,
        query,
        body: body ?? {},
      });
      if (method !== 'GET') save();
      else if (routeMatch.pattern === '/notifications' || routeMatch.pattern === '/notifications/unread-count') save();
      return { status, data: clone(data), headers };
    } catch (error) {
      if (error instanceof HttpError) {
        return {
          status: error.status,
          headers: { 'content-type': 'application/json' },
          data: { errorCode: error.errorCode, message: error.message, timestamp: stamp(), ...(error.fields ? { fields: error.fields } : {}) },
        };
      }
      // Unexpected failure: generic message, no stack trace (PRJ-SR-006).
      return {
        status: 500,
        headers: { 'content-type': 'application/json' },
        data: { errorCode: 'INTERNAL_ERROR', message: 'Something went wrong on the server.', timestamp: stamp() },
      };
    }
  }

  return { handle, reset, generateDueReminders };
}

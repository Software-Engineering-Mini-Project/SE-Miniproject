// In-browser mock of the Express REST API (SRS §3.2, SAD §4).
//
// It exists so the UI can be built, demoed and tested before the backend is ready.
// It mirrors the contract the backend must honour: the same paths, status codes,
// the { errorCode, message, timestamp } envelope, role and project-membership checks,
// input validation and safe CSV export. It is NOT a security boundary — the real
// Express API is authoritative (PRJ-SR-003). Passwords here are synthetic fixtures.

import {
  LIMITS,
  REMINDER_WINDOW_HOURS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../constants.js';
import { toCsv } from './csv.js';

export const MOCK_PASSWORD = 'Password123!';
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    users: seed.users.map((u) => ({
      ...clone(u),
      emailNormalized: normalizeEmail(u.email),
      password: MOCK_PASSWORD,
    })),
    projects: clone(seed.projects),
    tasks: clone(seed.tasks),
    comments: clone(seed.comments),
    notifications: clone(seed.notifications),
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
export function createMockServer({ seed, storage = null, now = () => new Date(), storageKey = 'taskline.mockdb.v1' }) {
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
  const stamp = () => now().toISOString();

  // ---------- DTO mapping (never expose password / passwordHash) ----------
  const userDto = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, updatedAt: u.updatedAt });
  const memberDto = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  const findUser = (id) => db.users.find((u) => u.id === id);
  const projectDto = (p) => ({
    ...clone(p),
    members: p.memberIds.map(findUser).filter(Boolean).map(memberDto),
  });
  const taskDto = (t) => clone(t);

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
    return user;
  }

  const isAdmin = (user) => user.role === 'Admin';
  const isMember = (user, project) => isAdmin(user) || project.memberIds.includes(user.id);
  const canManage = (user, project) =>
    isAdmin(user) || (user.role === 'Lead' && project.memberIds.includes(user.id));

  function projectFor(user, projectId, { manage = false } = {}) {
    idParam(projectId, 'project');
    const project = db.projects.find((p) => p.id === projectId);
    if (!project) notFound('Project');
    if (!isMember(user, project)) forbidden('You are not a member of this project.');
    if (manage && !canManage(user, project)) forbidden('Only the project lead or an admin can do this.');
    return project;
  }

  function taskFor(user, taskId, { manage = false } = {}) {
    idParam(taskId, 'task');
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) notFound('Task');
    const project = projectFor(user, task.projectId, { manage });
    return { task, project };
  }

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
    return unique;
  }

  function notifyAssignment(task, userIds, actor) {
    for (const userId of userIds) {
      if (userId === actor.id) continue;
      db.notifications.push({
        id: nextId('notif'),
        userId,
        taskId: task.id,
        type: 'assignment',
        message: `You were assigned to "${task.title}".`,
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
        message: `"${task.title}" is due within ${REMINDER_WINDOW_HOURS} hours.`,
        read: false,
        createdAt: stamp(),
        dedupeKey,
      });
      created = true;
    }
    return created;
  }

  function removeTaskCascade(taskId) {
    // Deletion policy used by the mock (decision pending in SAD §3.5): cascade comments and notifications.
    db.tasks = db.tasks.filter((t) => t.id !== taskId);
    db.comments = db.comments.filter((c) => c.taskId !== taskId);
    db.notifications = db.notifications.filter((n) => n.taskId !== taskId);
  }

  function isOverdue(task) {
    if (task.status === 'Done' || !task.dueDate) return false;
    return Date.parse(`${task.dueDate}T23:59:59Z`) < now().getTime();
  }

  function matchesFilters(task, query) {
    if (query.status && task.status !== query.status) return false;
    if (query.priority && task.priority !== query.priority) return false;
    if (query.assigneeId && !task.assigneeIds.includes(query.assigneeId)) return false;
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
    return filters;
  }

  // ---------- routes ----------
  const routes = [
    ['POST', '/auth/register', ({ body }) => {
      const name = str(body, 'name', { max: LIMITS.nameMax, label: 'Name' });
      const emailRaw = str(body, 'email', { max: 254, label: 'Email' });
      if (!EMAIL_RE.test(emailRaw)) badRequest('Enter a valid email address.', { email: 'Enter a valid email address.' });
      const password = passwordRule(body?.password);
      const emailNormalized = normalizeEmail(emailRaw);
      if (db.users.some((u) => u.emailNormalized === emailNormalized)) {
        fail(409, 'DUPLICATE_EMAIL', 'An account with this email already exists.', { email: 'This email is already registered.' });
      }
      const at = stamp();
      // Public registration never self-assigns elevated roles (SRS §2.2).
      const user = { id: nextId('user'), name, email: emailRaw, emailNormalized, role: 'Member', password, createdAt: at, updatedAt: at };
      db.users.push(user);
      return [201, { userId: user.id, email: user.email }];
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
      const token = encodeToken({ sub: user.id, exp: Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS });
      return [200, { token, expiresIn: TOKEN_TTL_SECONDS }];
    }],

    ['GET', '/auth/me', ({ user }) => [200, userDto(user)]],

    ['PATCH', '/users/me', ({ user, body }) => {
      const name = str(body, 'name', { required: false, max: LIMITS.nameMax, label: 'Name' });
      if (body?.newPassword !== undefined) {
        if (typeof body.currentPassword !== 'string' || body.currentPassword !== user.password) {
          badRequest('Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
        }
        user.password = passwordRule(body.newPassword, 'newPassword');
      }
      if (name) user.name = name;
      user.updatedAt = stamp();
      return [200, userDto(user)];
    }],

    ['GET', '/projects', ({ user }) => {
      const list = db.projects.filter((p) => isMember(user, p)).map(projectDto);
      return [200, list];
    }],

    ['POST', '/projects', ({ user, body }) => {
      if (user.role === 'Member') forbidden('Only leads and admins can create projects.');
      const name = str(body, 'name', { max: LIMITS.projectNameMax, label: 'Project name' });
      const description = str(body, 'description', { required: false, max: LIMITS.descriptionMax, label: 'Description' }) || '';
      const at = stamp();
      const project = { id: nextId('project'), name, description, ownerId: user.id, memberIds: [user.id], createdAt: at, updatedAt: at };
      db.projects.push(project);
      return [201, projectDto(project)];
    }],

    ['GET', '/projects/:projectId', ({ user, params }) => [200, projectDto(projectFor(user, params.projectId))]],

    ['PATCH', '/projects/:projectId', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { manage: true });
      const name = str(body, 'name', { required: false, max: LIMITS.projectNameMax, label: 'Project name' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' });
      if (name) project.name = name;
      if (description !== undefined) project.description = description;
      project.updatedAt = stamp();
      return [200, projectDto(project)];
    }],

    ['DELETE', '/projects/:projectId', ({ user, params }) => {
      const project = projectFor(user, params.projectId, { manage: true });
      db.tasks.filter((t) => t.projectId === project.id).forEach((t) => removeTaskCascade(t.id));
      db.projects = db.projects.filter((p) => p.id !== project.id);
      return [204, null];
    }],

    ['GET', '/projects/:projectId/members', ({ user, params }) => [200, projectDto(projectFor(user, params.projectId)).members]],

    ['POST', '/projects/:projectId/members', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { manage: true });
      const email = str(body, 'email', { max: 254, label: 'Email' });
      const member = db.users.find((u) => u.emailNormalized === normalizeEmail(email));
      if (!member) fail(404, 'NOT_FOUND', 'No registered user has this email.', { email: 'No registered user has this email.' });
      if (!project.memberIds.includes(member.id)) project.memberIds.push(member.id);
      project.updatedAt = stamp();
      return [200, projectDto(project).members];
    }],

    ['DELETE', '/projects/:projectId/members/:userId', ({ user, params }) => {
      const project = projectFor(user, params.projectId, { manage: true });
      idParam(params.userId, 'user');
      if (params.userId === project.ownerId) badRequest('The project owner cannot be removed.');
      if (!project.memberIds.includes(params.userId)) notFound('Member');
      project.memberIds = project.memberIds.filter((id) => id !== params.userId);
      // Removing a member also unassigns them so no task points at a non-member.
      db.tasks
        .filter((t) => t.projectId === project.id)
        .forEach((t) => {
          t.assigneeIds = t.assigneeIds.filter((id) => id !== params.userId);
        });
      project.updatedAt = stamp();
      return [200, projectDto(project).members];
    }],

    ['GET', '/projects/:projectId/tasks', ({ user, params, query }) => {
      const project = projectFor(user, params.projectId);
      const filters = readFilters(query);
      return [200, db.tasks.filter((t) => t.projectId === project.id && matchesFilters(t, filters)).map(taskDto)];
    }],

    ['POST', '/projects/:projectId/tasks', ({ user, params, body }) => {
      const project = projectFor(user, params.projectId, { manage: true });
      const title = str(body, 'title', { max: LIMITS.taskTitleMax, label: 'Title' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' }) || '';
      const status = oneOf(body, 'status', TASK_STATUSES, { required: false, label: 'Status' }) || 'To Do';
      const priority = oneOf(body, 'priority', TASK_PRIORITIES, { required: false, label: 'Priority' }) || 'Medium';
      const dueDate = dateOnly(body, 'dueDate', { label: 'Due date' });
      const assigneeIds = validateAssignees(body, project) || [];
      const at = stamp();
      const task = { id: nextId('task'), title, description, status, priority, dueDate, projectId: project.id, assigneeIds, createdAt: at, updatedAt: at };
      db.tasks.push(task);
      notifyAssignment(task, assigneeIds, user);
      return [201, taskDto(task)];
    }],

    ['GET', '/tasks', ({ user, query }) => {
      const filters = readFilters(query);
      const visible = db.tasks.filter((t) => {
        const project = db.projects.find((p) => p.id === t.projectId);
        if (!project || !isMember(user, project)) return false;
        if (filters.projectId && t.projectId !== filters.projectId) return false;
        return matchesFilters(t, filters);
      });
      return [200, visible.map(taskDto)];
    }],

    ['GET', '/tasks/:taskId', ({ user, params }) => [200, taskDto(taskFor(user, params.taskId).task)]],

    ['PATCH', '/tasks/:taskId', ({ user, params, body }) => {
      const { task, project } = taskFor(user, params.taskId, { manage: true });
      const title = str(body, 'title', { required: false, max: LIMITS.taskTitleMax, label: 'Title' });
      const description = str(body, 'description', { required: false, min: 0, max: LIMITS.descriptionMax, label: 'Description' });
      const status = oneOf(body, 'status', TASK_STATUSES, { required: false, label: 'Status' });
      const priority = oneOf(body, 'priority', TASK_PRIORITIES, { required: false, label: 'Priority' });
      const dueDate = body && 'dueDate' in body ? dateOnly(body, 'dueDate', { label: 'Due date' }) : undefined;
      const assigneeIds = validateAssignees(body, project);
      if (title) task.title = title;
      if (description !== undefined) task.description = description;
      if (status) task.status = status;
      if (priority) task.priority = priority;
      if (dueDate !== undefined) task.dueDate = dueDate;
      if (assigneeIds) {
        const added = assigneeIds.filter((id) => !task.assigneeIds.includes(id));
        task.assigneeIds = assigneeIds;
        notifyAssignment(task, added, user);
      }
      task.updatedAt = stamp();
      return [200, taskDto(task)];
    }],

    ['DELETE', '/tasks/:taskId', ({ user, params }) => {
      const { task } = taskFor(user, params.taskId, { manage: true });
      removeTaskCascade(task.id);
      return [204, null];
    }],

    // Any project member may move a task between columns (SRS §2.2 "update permitted task status").
    ['PATCH', '/tasks/:taskId/status', ({ user, params, body }) => {
      const { task } = taskFor(user, params.taskId);
      task.status = oneOf(body, 'status', TASK_STATUSES, { label: 'Status' });
      task.updatedAt = stamp();
      return [200, { taskId: task.id, status: task.status, updatedAt: task.updatedAt }];
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
      const { task } = taskFor(user, params.taskId);
      const text = str(body, 'text', { max: LIMITS.commentMax, label: 'Comment' });
      const comment = { id: nextId('comment'), taskId: task.id, authorId: user.id, text, createdAt: stamp() };
      db.comments.push(comment);
      return [201, { ...clone(comment), author: memberDto(user) }];
    }],

    ['GET', '/notifications', ({ user, query }) => {
      generateDueReminders(user);
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

    ['GET', '/projects/:projectId/summary', ({ user, params }) => {
      const project = projectFor(user, params.projectId);
      const tasks = db.tasks.filter((t) => t.projectId === project.id);
      const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
      return [200, { projectId: project.id, total: tasks.length, counts, overdue: tasks.filter(isOverdue).length }];
    }],

    ['GET', '/projects/:projectId/tasks/export.csv', ({ user, params, query }) => {
      const project = projectFor(user, params.projectId);
      const filters = readFilters(query);
      const rows = db.tasks
        .filter((t) => t.projectId === project.id && matchesFilters(t, filters))
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate || '',
          assignees: t.assigneeIds.map((id) => findUser(id)?.name || id).join('; '),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));
      const headers = ['id', 'title', 'status', 'priority', 'dueDate', 'assignees', 'createdAt', 'updatedAt'];
      return [200, toCsv(headers, rows), { 'content-type': 'text/csv; charset=utf-8' }];
    }],
  ];

  const PUBLIC = new Set(['POST /auth/register', 'POST /auth/login']);
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
      else if (routeMatch.pattern === '/notifications') save();
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

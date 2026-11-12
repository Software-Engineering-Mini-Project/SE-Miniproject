// The one centralized API client (SAD §6.2). Components call `api.*`; nothing else
// knows about URLs, tokens, transports or the error envelope.
//
// Endpoint paths follow SRS §3.2 / SAD §4. Request/response shapes not fixed by those
// documents are marked "DECISION" and must be confirmed with the backend owner.

import { localToday } from '../dates.js';
import { ApiError } from './errors.js';
import { invalidateQuery } from '../hooks/useQuery.js';

const API_BASE_URL = '/api';
const API_MODE = process.env.NEXT_PUBLIC_API_MODE === 'mock' ? 'mock' : 'http';

export const apiConfig = { baseUrl: API_BASE_URL, mode: API_MODE };

/**
 * @typedef {{ id: string, name: string, email: string, role: import('../constants.js').UserRole, createdAt?: string, updatedAt?: string }} User
 * @typedef {{ id: string, name: string, email: string, role: string, active?: boolean, projectRole?: 'Owner' | 'Manager' | 'Member' | 'Viewer' }} Member
 * @typedef {{ id: string, name: string, description: string, key: string | null, previousKeys?: string[], visibility: 'private' | 'open', ownerId: string, memberIds: string[], managerIds?: string[], viewerIds?: string[], members: Member[], createdAt: string, updatedAt: string }} Project
 * @typedef {{ id: string, name: string, key?: string | null, description: string, ownerName: string | null, memberCount: number }} DirectoryProject
 * @typedef {{ projectCreation: 'everyone' | 'leads' }} WorkspaceSettings
 * @typedef {{ id: string, name: string, projectCreation: 'everyone' | 'leads', createdAt: string, memberCount: number, projectCount?: number, joinCode?: string }} Organisation  (projectCount and joinCode: Admins only)
 * @typedef {{ id: string, name: string, description: string, visibility: 'private' | 'open', ownerName: string | null, memberCount: number, yourRole: string | null, updatedAt: string, total: number, counts: Record<string, number>, overdue: number }} OrganisationProject
 * @typedef {{ id: string, email: string, state: 'pending' | 'accepted' | 'revoked' | 'expired', createdAt: string, expiresAt: string, acceptedAt: string | null, revokedAt: string | null, createdBy: { id: string, name: string | null } | null }} Invitation
 * @typedef {{ email: string, expiresAt: string, organisation: { id: string, name: string } }} InvitationPreview
 * @typedef {{ projects: OrganisationProject[], totals: { people: number, projects: number, tasks: number, done: number, overdue: number } }} OrganisationOverview
 * @typedef {{ id: string, title: string, description: string, status: import('../constants.js').TaskStatus, priority: import('../constants.js').TaskPriority, dueDate: string | null, completedAt?: string | null, checklist?: ChecklistItem[], projectId: string, number?: number | null, key?: string | null, assigneeIds: string[], createdAt: string, updatedAt: string }} Task  (key: work-item key such as ALPHA-12)
 * @typedef {{ id: string, text: string, done: boolean }} ChecklistItem
 * @typedef {{ taskIds: string[], count: number, points: number }} SprintPart
 * @typedef {{ sprintId: string, unit: 'points' | 'items', days: { date: string, remaining: number | null, ideal: number }[], committed: SprintPart, added: SprintPart, removed: SprintPart, completed: SprintPart, carriedOver: SprintPart & { movedTo: string | null } }} SprintReport  (src/lib/sprint-report.js)
 * @typedef {{ id: string, projectId: string, number: number, name: string, goal: string, startDate: string, endDate: string, state: 'planned' | 'active' | 'completed', startedAt: string | null, completedAt: string | null, committed: { taskIds: string[], points: number } | null, report: { completed: SprintPart, unfinished: SprintPart, movedTo: string | null } | null }} Sprint  (src/lib/sprints.js)
 * @typedef {{ id: string, taskId: string, projectId: string, actorId: string | null, action: string, details: object, createdAt: string, actor: { id: string, name: string } | null }} Activity  (src/lib/activity.js)
 * @typedef {{ id: string, taskId: string, authorId: string, text: string, createdAt: string, author: Member | null }} Comment
 * @typedef {{ id: string, userId: string, taskId: string, projectId: string | null, type: 'assignment' | 'due-date', message: string, read: boolean, createdAt: string }} Notification
 * @typedef {{ items: Notification[], page: number, pageSize: number, total: number, unreadCount: number }} NotificationPage
 * @typedef {{ projectId: string, total: number, counts: Record<string, number>, overdue: number }} ProjectSummary
 * @typedef {{ q?: string, status?: string, priority?: string, assigneeId?: string, projectId?: string }} TaskFilters
 */

let tokenProvider = () => null;
let unauthorizedHandler = () => {};

/** The session store registers how to read the token and what to do on a 401. */
export function configureApi({ getToken, onUnauthorized }) {
  if (getToken) tokenProvider = getToken;
  if (onUnauthorized) unauthorizedHandler = onUnauthorized;
}

function buildQuery(query) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function httpTransport(method, path, { body, token, query, accept }) {
  const headers = new Headers({ Accept: accept || 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, { errorCode: 'NETWORK_ERROR', message: 'Could not reach the server.' });
  }
  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (response.status !== 204) {
    data = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  }
  return { status: response.status, data };
}

let mockServerPromise = null;
function getMockServer() {
  if (!mockServerPromise) {
    mockServerPromise = import('./mock/browser.js').then((m) => m.getBrowserMockServer());
  }
  return mockServerPromise;
}

async function mockTransport(method, path, { body, token, query }) {
  const server = await getMockServer();
  // Realistic latency so loading states are visible and exercised during development.
  await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 220));
  const cleanQuery = Object.fromEntries(
    Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  return server.handle(method, path, { body, token, query: cleanQuery });
}

async function request(method, path, { body, query, accept, auth = true, invalidates = [] } = {}) {
  if ((API_MODE === 'mock' || process.env.NODE_ENV !== 'production') && typeof window !== 'undefined' && typeof window.__taskManagerApiRequestObserver === 'function') {
    window.__taskManagerApiRequestObserver({ method, path });
  }
  const token = auth ? tokenProvider() : null;
  const transport = API_MODE === 'http' ? httpTransport : mockTransport;
  const { status, data } = await transport(method, path, { body, token, query, accept });
  if (status >= 200 && status < 300) {
    invalidates.forEach((prefix) => invalidateQuery(prefix));
    return data;
  }
  const error = new ApiError(status, data && typeof data === 'object' ? data : null);
  // A 401 for a token that has since been replaced (e.g. a poll racing a password change) is
  // stale and must not end the new session.
  if (status === 401 && auth && token === tokenProvider()) unauthorizedHandler(error);
  throw error;
}

const enc = encodeURIComponent;
export const api = {
  auth: {
    /** Who a personal invitation link is for and which organisation it joins. Public. @returns {Promise<InvitationPreview>} Issue #78 */
    invitation: (token) => request('GET', `/auth/invitations/${enc(token)}`, { auth: false }),
    /** Body adds exactly one of `inviteToken` (a personal link), `joinCode` (both join as a Member) or `organisationName` (start one, as its Admin). @returns {Promise<{ userId: string, email: string, role: string, organisation: { id: string, name: string } }>} TM-F-001 */
    register: (input) => request('POST', '/auth/register', { body: input, auth: false }),
    /** @returns {Promise<{ token: string, expiresIn: number }>} TM-F-002 */
    login: (input) => request('POST', '/auth/login', { body: input, auth: false }),
    /** @returns {Promise<User>} */
    me: () => request('GET', '/auth/me'),
  },
  users: {
    /** @returns {Promise<User>} TM-F-003 */
    /** A password change also returns `{ token, expiresIn }`: older sessions are revoked. */
    updateMe: (input) => request('PATCH', '/users/me', { body: input }),
    /** Admin only. @returns {Promise<{ items: (User & { projectCount: number })[], page: number, pageSize: number, total: number, roleCounts: Record<string, number> }>} */
    list: ({ q, role, status, page = 1, pageSize = 50 } = {}) => request('GET', '/users', { query: { q, role, status, page, pageSize } }),
    /** Admin only. @returns {Promise<User>} */
    setRole: (userId, role) => request('PATCH', `/users/${enc(userId)}/role`, { body: { role } }),
    /** Admin only. Deactivating signs the user out everywhere and blocks sign-in. @returns {Promise<User>} */
    setActive: (userId, active) => request('PATCH', `/users/${enc(userId)}/status`, { body: { active } }),
  },
  organisation: {
    /** The caller's organisation. The invite code is only sent to Admins. @returns {Promise<Organisation>} */
    get: () => request('GET', '/organisation'),
    /** Admin only. @returns {Promise<Organisation>} */
    update: (name) => request('PATCH', '/organisation', { invalidates: ['organisation:'], body: { name } }),
    /** Admin only. The old invite code stops working at once. @returns {Promise<Organisation>} */
    rotateJoinCode: () => request('POST', '/organisation/join-code', { invalidates: ['organisation:'] }),
    /** Personal invitation links, Admins only (issue #78). */
    invitations: {
      /** Newest first. @returns {Promise<Invitation[]>} */
      list: () => request('GET', '/organisation/invitations'),
      /** The response carries `token` and `path`: the only time the link is available. @returns {Promise<Invitation & { token: string, path: string }>} */
      create: (email) => request('POST', '/organisation/invitations', { invalidates: ['organisation:invitations:'], body: { email } }),
      /** The link stops working at once. @returns {Promise<Invitation>} */
      revoke: (invitationId) => request('DELETE', `/organisation/invitations/${enc(invitationId)}`, { invalidates: ['organisation:invitations:'] }),
    },
    /** Projects you are in plus open ones (Admins: all), with task counts. @returns {Promise<OrganisationOverview>} */
    overview: (today = localToday()) => request('GET', '/organisation/overview', { query: { today } }),
  },
  settings: {
    /** Everyone signed in. @returns {Promise<WorkspaceSettings>} */
    get: () => request('GET', '/settings'),
    /** Admin only. @returns {Promise<WorkspaceSettings>} */
    update: (input) => request('PATCH', '/settings', { body: input }),
  },
  projects: {
    /** @returns {Promise<Project[]>} */
    list: () => request('GET', '/projects'),
    /** Open projects the caller can join. @returns {Promise<DirectoryProject[]>} */
    directory: (q) => request('GET', '/projects/directory', { query: { q: q || undefined } }),
    /** Join an open project as a Member (201; 200 if already in it). @returns {Promise<Project>} */
    join: (projectId) => request('POST', `/projects/${enc(projectId)}/join`, { invalidates: ['dashboard:', 'organisation:', 'directory:', `project:${projectId}`, `tasks:${projectId}`] }),
    /** @returns {Promise<Project>} TM-F-020 */
    create: (input) => request('POST', '/projects', { invalidates: ['dashboard:', 'organisation:'], body: input }),
    /** @returns {Promise<Project>} DECISION: response embeds `members` (safe user fields). */
    get: (projectId) => request('GET', `/projects/${enc(projectId)}`),
    // A new key changes every task key in the project, so cached task lists are refetched too.
    update: (projectId, input) => request('PATCH', `/projects/${enc(projectId)}`, { invalidates: ['dashboard:', 'organisation:', 'directory:', `tasks:${projectId}`, 'search:'], body: input }),
    /** A free work-item key for a new project, from its name. @returns {Promise<{ key: string }>} */
    suggestKey: (name) => request('GET', '/projects/key-suggestion', { query: { name } }),
    remove: (projectId) => request('DELETE', `/projects/${enc(projectId)}`, { invalidates: ['dashboard:', 'organisation:'] }),
    /** @returns {Promise<ProjectSummary>} TM-F-041 */
    summary: (projectId) => request('GET', `/projects/${enc(projectId)}/summary`, { query: { today: localToday() } }),
    /** @returns {Promise<string>} CSV text, TM-F-042 */
    exportCsv: (projectId, filters) =>
      request('GET', `/projects/${enc(projectId)}/tasks/export.csv`, { query: filters, accept: 'text/csv' }),
  },
  dashboard: {
    /** @returns {Promise<{ projects: ProjectSummary[], myTasks: Task[] }>} */
    get: (today = localToday()) => request('GET', '/dashboard', { query: { today } }),
  },
  members: {
    /** @returns {Promise<Member[]>} */
    list: (projectId) => request('GET', `/projects/${enc(projectId)}/members`),
    /** Body is `{ email, role? }` of a registered user; role is Manager, Member (default) or Viewer. TM-F-021 */
    add: (projectId, email, role) => request('POST', `/projects/${enc(projectId)}/members`, { invalidates: ['dashboard:', 'organisation:'], body: role ? { email, role } : { email } }),
    /** Changes a project role; 'Owner' transfers ownership. @returns {Promise<Member[]>} */
    setRole: (projectId, userId, role) => request('PATCH', `/projects/${enc(projectId)}/members/${enc(userId)}`, { body: { role } }),
    remove: (projectId, userId) => request('DELETE', `/projects/${enc(projectId)}/members/${enc(userId)}`, { invalidates: ['dashboard:', 'organisation:', 'activity:'] }),
  },
  tasks: {
    /** @returns {Promise<Task[]>} */
    listByProject: (projectId, filters) => request('GET', `/projects/${enc(projectId)}/tasks`, { query: filters }),
    /** @returns {Promise<Task>} TM-F-010 / TM-F-022 */
    create: (projectId, input) => request('POST', `/projects/${enc(projectId)}/tasks`, { invalidates: ['dashboard:', 'organisation:'], body: input }),
    /** @returns {Promise<Task[]>} TM-F-040 */
    search: (filters) => request('GET', '/tasks', { query: filters }),
    /** @returns {Promise<Task>} */
    get: (taskId) => request('GET', `/tasks/${enc(taskId)}`),
    /** Opens a task by its key (ALPHA-12); old keys of a renamed project still resolve. @returns {Promise<Task>} */
    getByKey: (key) => request('GET', `/tasks/by-key/${enc(key)}`),
    /** @returns {Promise<Task>} TM-F-011 */
    update: (taskId, input) => request('PATCH', `/tasks/${enc(taskId)}`, { invalidates: ['dashboard:', 'organisation:', `activity:${taskId}`, 'sprints:report:'], body: input }),
    remove: (taskId) => request('DELETE', `/tasks/${enc(taskId)}`, { invalidates: ['dashboard:', 'organisation:'] }),
    /** @returns {Promise<{ taskId: string, status: string, updatedAt?: string }>} TM-F-012 */
    setStatus: (taskId, status) => request('PATCH', `/tasks/${enc(taskId)}/status`, { invalidates: ['dashboard:', 'organisation:', `activity:${taskId}`, 'sprints:report:'], body: { status } }),
    /** Who changed what on the task, newest first (issue #75). @returns {Promise<{ items: Activity[], page: number, pageSize: number, total: number }>} */
    activity: (taskId, { page = 1, pageSize = 50 } = {}) => request('GET', `/tasks/${enc(taskId)}/activity`, { query: { page, pageSize } }),
    /**
     * Plans a task (issue #76): into a sprint or the backlog (`sprintId`, null for the backlog)
     * and/or between two tasks in the ranked order (`previousId` above it, `nextId` below it).
     * @returns {Promise<Task>}
     */
    move: (taskId, { sprintId, previousId, nextId } = {}) => request('POST', `/tasks/${enc(taskId)}/move`, { invalidates: [`activity:${taskId}`, 'sprints:report:'], body: { sprintId, previousId, nextId } }),
  },
  // Sprints change which tasks are where, so they refresh task lists and histories too.
  sprints: {
    /** @returns {Promise<Sprint[]>} */
    list: (projectId) => request('GET', `/projects/${enc(projectId)}/sprints`),
    /** Burndown and report, from the activity history (issue #77). @returns {Promise<SprintReport>} */
    report: (sprintId) => request('GET', `/sprints/${enc(sprintId)}/report`),
    /** Owners and Managers. @returns {Promise<Sprint>} */
    create: (projectId, input) => request('POST', `/projects/${enc(projectId)}/sprints`, { invalidates: [`sprints:${projectId}`], body: input }),
    update: (sprintId, input) => request('PATCH', `/sprints/${enc(sprintId)}`, { invalidates: ['sprints:'], body: input }),
    /** Planned sprints only; their tasks go back to the backlog. */
    remove: (sprintId) => request('DELETE', `/sprints/${enc(sprintId)}`, { invalidates: ['sprints:', 'tasks:', 'activity:'] }),
    /** 409 ACTIVE_SPRINT_EXISTS while another sprint in the project is active. */
    start: (sprintId) => request('POST', `/sprints/${enc(sprintId)}/start`, { invalidates: ['sprints:'] }),
    /** Unfinished tasks go to `moveTo`: 'backlog' or a planned sprint's id. */
    complete: (sprintId, moveTo = 'backlog') => request('POST', `/sprints/${enc(sprintId)}/complete`, { invalidates: ['sprints:', 'tasks:', 'activity:', 'dashboard:'], body: { moveTo } }),
  },
  checklist: {
    /** @returns {Promise<{ taskId: string, checklist: ChecklistItem[], updatedAt: string }>} */
    add: (taskId, text) => request('POST', `/tasks/${enc(taskId)}/checklist`, { invalidates: [`activity:${taskId}`], body: { text } }),
    /** `changes`: { done } and/or { text }. Owners, managers and members; viewers cannot. */
    update: (taskId, itemId, changes) => request('PATCH', `/tasks/${enc(taskId)}/checklist/${enc(itemId)}`, { invalidates: [`activity:${taskId}`], body: changes }),
    remove: (taskId, itemId) => request('DELETE', `/tasks/${enc(taskId)}/checklist/${enc(itemId)}`, { invalidates: [`activity:${taskId}`] }),
  },
  comments: {
    /** @returns {Promise<Comment[]>} TM-F-032. DECISION: each comment embeds `author`. */
    list: (taskId) => request('GET', `/tasks/${enc(taskId)}/comments`),
    create: (taskId, text) => request('POST', `/tasks/${enc(taskId)}/comments`, { invalidates: [`activity:${taskId}`], body: { text } }),
    remove: (taskId, commentId) => request('DELETE', `/tasks/${enc(taskId)}/comments/${enc(commentId)}`, { invalidates: [`activity:${taskId}`] }),
  },
  notifications: {
    /** @returns {Promise<NotificationPage>} TM-F-030 / TM-F-031. DECISION: page shape incl. `unreadCount`. */
    list: (page = 1, pageSize) => request('GET', '/notifications', { query: { page, pageSize } }),
    unreadCount: () => request('GET', '/notifications/unread-count'),
    markRead: (notificationId) => request('PATCH', `/notifications/${enc(notificationId)}/read`),
    markAllRead: () => request('PATCH', '/notifications/read-all'),
  },
};

/** Clears the mock database back to the fixtures (mock mode only). */
export async function resetMockData() {
  if (API_MODE !== 'mock') return;
  const server = await getMockServer();
  server.reset();
}

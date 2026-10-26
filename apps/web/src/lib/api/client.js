// The one centralized API client (SAD §6.2). Components call `api.*`; nothing else
// knows about URLs, tokens, transports or the error envelope.
//
// Endpoint paths follow SRS §3.2 / SAD §4. Request/response shapes not fixed by those
// documents are marked "DECISION" and must be confirmed with the backend owner.

import { ApiError } from './errors.js';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const API_MODE = process.env.NEXT_PUBLIC_API_MODE === 'mock' ? 'mock' : 'http';

export const apiConfig = { baseUrl: API_BASE_URL, mode: API_MODE };

/**
 * @typedef {{ id: string, name: string, email: string, role: import('../constants.js').UserRole, createdAt?: string, updatedAt?: string }} User
 * @typedef {{ id: string, name: string, email: string, role: string }} Member
 * @typedef {{ id: string, name: string, description: string, ownerId: string, memberIds: string[], members: Member[], createdAt: string, updatedAt: string }} Project
 * @typedef {{ id: string, title: string, description: string, status: import('../constants.js').TaskStatus, priority: import('../constants.js').TaskPriority, dueDate: string | null, projectId: string, assigneeIds: string[], createdAt: string, updatedAt: string }} Task
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

async function request(method, path, { body, query, accept, auth = true } = {}) {
  const token = auth ? tokenProvider() : null;
  const transport = API_MODE === 'http' ? httpTransport : mockTransport;
  const { status, data } = await transport(method, path, { body, token, query, accept });
  if (status >= 200 && status < 300) return data;
  const error = new ApiError(status, data && typeof data === 'object' ? data : null);
  if (status === 401 && auth) unauthorizedHandler(error);
  throw error;
}

const enc = encodeURIComponent;

export const api = {
  auth: {
    /** @returns {Promise<{ userId: string, email: string }>} TM-F-001 */
    register: (input) => request('POST', '/auth/register', { body: input, auth: false }),
    /** @returns {Promise<{ token: string, expiresIn: number }>} TM-F-002 */
    login: (input) => request('POST', '/auth/login', { body: input, auth: false }),
    /** @returns {Promise<User>} */
    me: () => request('GET', '/auth/me'),
  },
  users: {
    /** @returns {Promise<User>} TM-F-003 */
    updateMe: (input) => request('PATCH', '/users/me', { body: input }),
  },
  projects: {
    /** @returns {Promise<Project[]>} */
    list: () => request('GET', '/projects'),
    /** @returns {Promise<Project>} TM-F-020 */
    create: (input) => request('POST', '/projects', { body: input }),
    /** @returns {Promise<Project>} DECISION: response embeds `members` (safe user fields). */
    get: (projectId) => request('GET', `/projects/${enc(projectId)}`),
    update: (projectId, input) => request('PATCH', `/projects/${enc(projectId)}`, { body: input }),
    remove: (projectId) => request('DELETE', `/projects/${enc(projectId)}`),
    /** @returns {Promise<ProjectSummary>} TM-F-041 */
    summary: (projectId) => request('GET', `/projects/${enc(projectId)}/summary`),
    /** @returns {Promise<string>} CSV text, TM-F-042 */
    exportCsv: (projectId, filters) =>
      request('GET', `/projects/${enc(projectId)}/tasks/export.csv`, { query: filters, accept: 'text/csv' }),
  },
  members: {
    /** @returns {Promise<Member[]>} */
    list: (projectId) => request('GET', `/projects/${enc(projectId)}/members`),
    /** DECISION: body is `{ email }` of a registered user. TM-F-021 */
    add: (projectId, email) => request('POST', `/projects/${enc(projectId)}/members`, { body: { email } }),
    remove: (projectId, userId) => request('DELETE', `/projects/${enc(projectId)}/members/${enc(userId)}`),
  },
  tasks: {
    /** @returns {Promise<Task[]>} */
    listByProject: (projectId, filters) => request('GET', `/projects/${enc(projectId)}/tasks`, { query: filters }),
    /** @returns {Promise<Task>} TM-F-010 / TM-F-022 */
    create: (projectId, input) => request('POST', `/projects/${enc(projectId)}/tasks`, { body: input }),
    /** @returns {Promise<Task[]>} TM-F-040 */
    search: (filters) => request('GET', '/tasks', { query: filters }),
    /** @returns {Promise<Task>} */
    get: (taskId) => request('GET', `/tasks/${enc(taskId)}`),
    /** @returns {Promise<Task>} TM-F-011 */
    update: (taskId, input) => request('PATCH', `/tasks/${enc(taskId)}`, { body: input }),
    remove: (taskId) => request('DELETE', `/tasks/${enc(taskId)}`),
    /** @returns {Promise<{ taskId: string, status: string, updatedAt?: string }>} TM-F-012 */
    setStatus: (taskId, status) => request('PATCH', `/tasks/${enc(taskId)}/status`, { body: { status } }),
  },
  comments: {
    /** @returns {Promise<Comment[]>} TM-F-032. DECISION: each comment embeds `author`. */
    list: (taskId) => request('GET', `/tasks/${enc(taskId)}/comments`),
    create: (taskId, text) => request('POST', `/tasks/${enc(taskId)}/comments`, { body: { text } }),
  },
  notifications: {
    /** @returns {Promise<NotificationPage>} TM-F-030 / TM-F-031. DECISION: page shape incl. `unreadCount`. */
    list: (page = 1) => request('GET', '/notifications', { query: { page } }),
    markRead: (notificationId) => request('PATCH', `/notifications/${enc(notificationId)}/read`),
  },
};

/** Clears the mock database back to the fixtures (mock mode only). */
export async function resetMockData() {
  if (API_MODE !== 'mock') return;
  const server = await getMockServer();
  server.reset();
}

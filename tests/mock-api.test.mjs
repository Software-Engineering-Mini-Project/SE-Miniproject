// Contract tests for the mock API. Test names carry the STP test IDs they mirror,
// so the same cases can be replayed against the real Express API with Supertest.
import test from 'node:test';
import assert from 'node:assert/strict';
import users from '../fixtures/users.json' with { type: 'json' };
import projects from '../fixtures/projects.json' with { type: 'json' };
import tasks from '../fixtures/tasks.json' with { type: 'json' };
import comments from '../fixtures/comments.json' with { type: 'json' };
import notifications from '../fixtures/notifications.json' with { type: 'json' };
import negatives from '../fixtures/negative-inputs.json' with { type: 'json' };
import { createMockServer, MOCK_PASSWORD } from '../src/lib/api/mock/server.js';
import { csvCell } from '../src/lib/api/mock/csv.js';

const seed = { users, projects, tasks, comments, notifications };
const NOW = new Date('2026-10-16T10:00:00.000Z');

function setup(now = () => NOW) {
  const server = createMockServer({ seed, now });
  const call = (method, path, opts) => server.handle(method, path, opts);
  const login = (email) => call('POST', '/auth/login', { body: { email, password: MOCK_PASSWORD } }).data.token;
  return { server, call, login };
}

const assertEnvelope = (res, status, errorCode) => {
  assert.equal(res.status, status);
  assert.equal(res.data.errorCode, errorCode);
  assert.equal(typeof res.data.message, 'string');
  assert.ok(!Number.isNaN(Date.parse(res.data.timestamp)));
  assert.ok(!('stack' in res.data));
};

test('TC-AUTH-01 registration accepts valid fields and never returns a password', () => {
  const { call } = setup();
  const res = call('POST', '/auth/register', { body: { name: 'New User', email: 'New@Example.test', password: 'abc12345' } });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.data).sort(), ['email', 'userId']);
});

test('TC-AUTH-01-N duplicate email (case-insensitive) is 409 and invalid payloads are 400', () => {
  const { call } = setup();
  assertEnvelope(call('POST', '/auth/register', { body: { name: 'Dup', email: negatives.duplicateEmail.toUpperCase(), password: 'abc12345' } }), 409, 'DUPLICATE_EMAIL');
  assertEnvelope(call('POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', password: 'abc12345' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/auth/register', { body: { name: 'X', email: 'x@example.test', password: 'short' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/auth/register', { body: { name: negatives.noSqlInjectionLike, email: 'y@example.test', password: 'abc12345' } }), 400, 'VALIDATION_ERROR');
});

test('registration never self-assigns an elevated role (SRS 2.2)', () => {
  const { call } = setup();
  call('POST', '/auth/register', { body: { name: 'Sneaky', email: 'sneaky@example.test', password: 'abc12345', role: 'Admin' } });
  const { token } = call('POST', '/auth/login', { body: { email: 'sneaky@example.test', password: 'abc12345' } }).data;
  const me = call('GET', '/auth/me', { token });
  assert.equal(me.data.role, 'Member');
});

test('TC-AUTH-02 login returns an expiring token and /auth/me a safe profile', () => {
  const { call, login } = setup();
  const res = call('POST', '/auth/login', { body: { email: 'lead@example.test', password: MOCK_PASSWORD } });
  assert.equal(res.status, 200);
  assert.ok(res.data.expiresIn > 0);
  const me = call('GET', '/auth/me', { token: login('lead@example.test') });
  assert.equal(me.data.email, 'lead@example.test');
  assert.ok(!('password' in me.data) && !('passwordHash' in me.data));
  assertEnvelope(call('POST', '/auth/login', { body: { email: 'lead@example.test', password: 'wrong' } }), 401, 'INVALID_CREDENTIALS');
});

test('TC-SEC-02 missing, malformed, tampered and expired tokens are rejected with 401', () => {
  const { call, login } = setup();
  assertEnvelope(call('GET', '/auth/me'), 401, 'UNAUTHENTICATED');
  assertEnvelope(call('GET', '/auth/me', { token: negatives.jwtCases[1] }), 401, 'INVALID_TOKEN');
  const token = login('member@example.test');
  assertEnvelope(call('GET', '/auth/me', { token: token.replace('mock.', 'mock.x') }), 401, 'INVALID_TOKEN');
  let clock = NOW;
  const timed = setup(() => clock);
  const shortLived = timed.login('member@example.test');
  clock = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
  assertEnvelope(timed.call('GET', '/auth/me', { token: shortLived }), 401, 'TOKEN_EXPIRED');
});

test('TC-SEC-06 repeated failed logins are rate limited with 429', () => {
  const { call } = setup();
  for (let i = 0; i < 5; i += 1) call('POST', '/auth/login', { body: { email: 'admin@example.test', password: 'nope' } });
  assertEnvelope(call('POST', '/auth/login', { body: { email: 'admin@example.test', password: MOCK_PASSWORD } }), 429, 'RATE_LIMITED');
});

test('TC-AUTH-03 profile name and password updates persist', () => {
  const { call, login } = setup();
  const token = login('member@example.test');
  assert.equal(call('PATCH', '/users/me', { token, body: { name: 'Renamed' } }).data.name, 'Renamed');
  assertEnvelope(call('PATCH', '/users/me', { token, body: { currentPassword: 'bad', newPassword: 'newpass123' } }), 400, 'VALIDATION_ERROR');
  call('PATCH', '/users/me', { token, body: { currentPassword: MOCK_PASSWORD, newPassword: 'newpass123' } });
  assert.equal(call('POST', '/auth/login', { body: { email: 'member@example.test', password: 'newpass123' } }).status, 200);
});

test('TC-PROJ-01 anyone creates projects by default; an admin can limit it to leads; outsiders see no projects', () => {
  const { call, login } = setup();
  const created = call('POST', '/projects', { token: login('lead@example.test'), body: { name: 'Gamma', description: 'New' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.memberIds, ['user-lead-001']);
  assert.equal(created.data.visibility, 'private');
  const admin = login('admin@example.test');
  const member = login('member@example.test');
  assert.equal(call('POST', '/projects', { token: member, body: { name: 'Mine' } }).status, 201);
  assert.deepEqual(call('GET', '/projects', { token: login('outsider@example.test') }).data, []);

  assert.deepEqual(call('GET', '/settings', { token: member }).data, { projectCreation: 'everyone' });
  assertEnvelope(call('PATCH', '/settings', { token: member, body: { projectCreation: 'leads' } }), 403, 'FORBIDDEN');
  assertEnvelope(call('PATCH', '/settings', { token: admin, body: { projectCreation: 'nobody' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('PATCH', '/settings', { token: admin, body: {} }), 400, 'VALIDATION_ERROR');
  assert.deepEqual(call('PATCH', '/settings', { token: admin, body: { projectCreation: 'leads' } }).data, { projectCreation: 'leads' });
  const blocked = call('POST', '/projects', { token: member, body: { name: 'Not now' } });
  assertEnvelope(blocked, 403, 'FORBIDDEN');
  assert.match(blocked.data.message, /only leads and admins can create projects/);
  assert.equal(call('POST', '/projects', { token: login('lead@example.test'), body: { name: 'Lead one' } }).status, 201);
});

test('open projects: directory, join, JOIN_REQUIRED and visibility changes mirror the API', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const outsider = login('outsider@example.test');
  const created = call('POST', '/projects', { token: lead, body: { name: 'Design system', description: 'Shared components', visibility: 'open' } }).data;
  assert.equal(created.visibility, 'open');
  assertEnvelope(call('POST', '/projects', { token: lead, body: { name: 'Bad', visibility: 'public' } }), 400, 'VALIDATION_ERROR');

  assert.deepEqual(call('GET', '/projects/directory', { token: outsider }).data, [
    { id: created.id, name: 'Design system', description: 'Shared components', ownerName: 'Synthetic Lead', memberCount: 1 },
  ]);
  assert.deepEqual(call('GET', '/projects/directory', { token: lead }).data, [], 'projects you are in are not listed');
  assert.equal(call('GET', '/projects/directory', { token: outsider, query: { q: 'DESIGN' } }).data.length, 1);
  assert.equal(call('GET', '/projects/directory', { token: outsider, query: { q: 'alpha' } }).data.length, 0, 'private projects never appear');

  assertEnvelope(call('GET', `/projects/${created.id}`, { token: outsider }), 403, 'JOIN_REQUIRED');
  assertEnvelope(call('GET', `/projects/${created.id}/tasks`, { token: outsider }), 403, 'JOIN_REQUIRED');
  assertEnvelope(call('GET', '/projects/project-alpha', { token: outsider }), 403, 'FORBIDDEN');

  const joined = call('POST', `/projects/${created.id}/join`, { token: outsider });
  assert.equal(joined.status, 201);
  assert.equal(joined.data.members.find((m) => m.id === 'user-outsider-001').projectRole, 'Member');
  assert.equal(call('POST', `/projects/${created.id}/join`, { token: outsider }).status, 200, 'joining twice is harmless');
  assert.equal(call('GET', `/projects/${created.id}`, { token: outsider }).data.memberIds.length, 2);
  assert.equal(call('POST', `/projects/${created.id}/tasks`, { token: outsider, body: { title: 'First contribution' } }).status, 201);

  const privateJoin = call('POST', '/projects/project-alpha/join', { token: outsider });
  assertEnvelope(privateJoin, 403, 'FORBIDDEN');
  assert.equal(privateJoin.data.message, 'This project is private. Ask its owner or a manager to add you.');
  assertEnvelope(call('POST', '/projects/nope/join', { token: outsider }), 404, 'NOT_FOUND');

  assertEnvelope(call('PATCH', `/projects/${created.id}`, { token: outsider, body: { visibility: 'private' } }), 403, 'FORBIDDEN');
  assertEnvelope(call('PATCH', `/projects/${created.id}`, { token: lead, body: { visibility: 'secret' } }), 400, 'VALIDATION_ERROR');
  const toPrivate = call('PATCH', `/projects/${created.id}`, { token: lead, body: { visibility: 'private' } }).data;
  assert.equal(toPrivate.visibility, 'private');
  assert.ok(toPrivate.memberIds.includes('user-outsider-001'), 'going private keeps members');
  assert.deepEqual(call('GET', '/projects/directory', { token: login('admin@example.test') }).data, []);
});

test('dashboard returns project aggregates and only the caller accessible tasks', () => {
  const { call, login } = setup();
  const lead = call('GET', '/dashboard', { token: login('lead@example.test') });
  assert.deepEqual(lead.data.projects.map((project) => project.projectId), ['project-alpha', 'project-beta']);
  assert.equal(lead.data.projects.find((project) => project.projectId === 'project-alpha').total, 7);
  assert.ok(lead.data.myTasks.every((task) => task.assigneeIds.includes('user-lead-001')));
  const outsider = call('GET', '/dashboard', { token: login('outsider@example.test') });
  assert.deepEqual(outsider.data, { projects: [], myTasks: [], stats: { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 } });
});

test('PATCH /notifications/read-all marks only the current caller unread items', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const before = call('GET', '/notifications', { token: lead }).data;
  const updated = call('PATCH', '/notifications/read-all', { token: lead });
  assert.deepEqual(updated.data, { updated: before.unreadCount });
  assert.equal(call('GET', '/notifications', { token: lead }).data.unreadCount, 0);
  assert.ok(call('GET', '/notifications', { token: login('member@example.test') }).data.unreadCount > 0);
});

test('TC-PROJ-02 / TC-SEC-03 membership rules and horizontal access', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const member = login('member@example.test');
  const outsider = login('outsider@example.test');
  assertEnvelope(call('GET', '/projects/project-alpha', { token: outsider }), 403, 'FORBIDDEN');
  assertEnvelope(call('GET', '/tasks/task-001', { token: outsider }), 403, 'FORBIDDEN');
  assertEnvelope(call('POST', '/projects/project-alpha/members', { token: member, body: { email: 'outsider@example.test' } }), 403, 'FORBIDDEN');
  assertEnvelope(call('POST', '/projects/project-alpha/members', { token: lead, body: { email: 'ghost@example.test' } }), 404, 'NOT_FOUND');
  const added = call('POST', '/projects/project-alpha/members', { token: lead, body: { email: 'outsider@example.test' } });
  assert.ok(added.data.some((m) => m.id === 'user-outsider-001'));
  assert.equal(call('GET', '/projects/project-alpha', { token: outsider }).status, 200);
});

test('TC-TASK-01 create task validates required fields and defaults status', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const created = call('POST', '/projects/project-alpha/tasks', { token: lead, body: { title: 'New task', priority: 'High', dueDate: '2026-10-30' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'To Do');
  assertEnvelope(call('POST', '/projects/project-alpha/tasks', { token: lead, body: { priority: 'High' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/projects/project-alpha/tasks', { token: lead, body: { title: 'x', dueDate: '2026-13-45' } }), 400, 'VALIDATION_ERROR');
  assert.equal(call('POST', '/projects/project-alpha/tasks', { token: login('member@example.test'), body: { title: 'Member task' } }).status, 201, 'members create tasks');
  const viewerCreate = call('POST', '/projects/project-alpha/tasks', { token: login('viewer@example.test'), body: { title: 'x' } });
  assertEnvelope(viewerCreate, 403, 'FORBIDDEN');
  assert.equal(viewerCreate.data.message, 'Viewers cannot create tasks.');
});

test('TC-TASK-02 edit and delete persist; delete cascades comments and notifications', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  assert.equal(call('PATCH', '/tasks/task-002', { token: lead, body: { title: 'Renamed' } }).data.title, 'Renamed');
  assert.equal(call('DELETE', '/tasks/task-002', { token: lead }).status, 204);
  assertEnvelope(call('GET', '/tasks/task-002', { token: lead }), 404, 'NOT_FOUND');
  assertEnvelope(call('GET', '/tasks/task-002/comments', { token: lead }), 404, 'NOT_FOUND');
});

test('TC-TASK-03 status changes persist and invalid statuses are 400', () => {
  const { call, login } = setup();
  const member = login('member@example.test');
  const res = call('PATCH', '/tasks/task-001/status', { token: member, body: { status: 'In Progress' } });
  assert.deepEqual([res.status, res.data.status], [200, 'In Progress']);
  for (const status of negatives.invalidStatuses) {
    assertEnvelope(call('PATCH', '/tasks/task-001/status', { token: member, body: { status } }), 400, 'VALIDATION_ERROR');
  }
  assertEnvelope(call('PATCH', '/tasks/task-001/status', { token: member, body: { status: negatives.noSqlInjectionLike } }), 400, 'VALIDATION_ERROR');
});

test('TC-BOARD-01 / TC-NOTIF-01 only members can be assigned; assignment notifies privately', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  assertEnvelope(call('PATCH', '/tasks/task-005', { token: lead, body: { assigneeIds: [negatives.nonMemberAssignee] } }), 400, 'VALIDATION_ERROR');
  call('PATCH', '/tasks/task-005', { token: lead, body: { assigneeIds: ['user-member-002', 'user-member-001'] } });
  const inbox = call('GET', '/notifications', { token: login('member@example.test') }).data;
  assert.ok(inbox.items.some((n) => n.taskId === 'task-005' && n.type === 'assignment'));
  const outsiderInbox = call('GET', '/notifications', { token: login('outsider@example.test') }).data;
  assert.equal(outsiderInbox.total, 0);
  const someoneElses = inbox.items[0].id;
  assertEnvelope(call('PATCH', `/notifications/${someoneElses}/read`, { token: lead }), 404, 'NOT_FOUND');
});

test('TC-NOTIF-02 due reminders are created once and skip Done tasks', () => {
  const { call, login } = setup(() => new Date('2026-10-17T06:00:00.000Z'));
  const member2 = login('member.two.with.a.long.address@example.test');
  const first = call('GET', '/notifications', { token: member2 }).data;
  const second = call('GET', '/notifications', { token: member2 }).data;
  const reminders = second.items.filter((n) => n.type === 'due-date' && n.taskId === 'task-004');
  assert.equal(reminders.length, 1);
  assert.equal(first.total, second.total);
  const lead = login('lead@example.test');
  assert.ok(!call('GET', '/notifications', { token: lead }).data.items.some((n) => n.type === 'due-date' && n.taskId === 'task-006'));
});

test('TC-COMM-01 comments persist with author; empty, oversized and outsider requests fail', () => {
  const { call, login } = setup();
  const member = login('member@example.test');
  const posted = call('POST', '/tasks/task-002/comments', { token: member, body: { text: negatives.xssLookingComment } });
  assert.equal(posted.status, 201);
  assert.equal(posted.data.text, negatives.xssLookingComment);
  assert.equal(posted.data.author.id, 'user-member-001');
  assertEnvelope(call('POST', '/tasks/task-002/comments', { token: member, body: { text: '   ' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/tasks/task-002/comments', { token: member, body: { text: 'x'.repeat(1001) } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/tasks/task-002/comments', { token: login('outsider@example.test'), body: { text: 'hi' } }), 403, 'FORBIDDEN');
  assertEnvelope(call('DELETE', '/tasks/task-002/comments/comment-001', { token: member }), 403, 'FORBIDDEN');
  assertEnvelope(call('DELETE', `/tasks/task-001/comments/${posted.data.id}`, { token: member }), 404, 'NOT_FOUND');
  assert.equal(call('DELETE', `/tasks/task-002/comments/${posted.data.id}`, { token: member }).status, 204);
  const lead = login('lead@example.test');
  assert.equal(call('DELETE', '/tasks/task-002/comments/comment-001', { token: lead }).status, 204);
});

test('TC-SEARCH-01 filters combine and only authorized tasks are returned', () => {
  const { call, login } = setup();
  const member = login('member@example.test');
  const all = call('GET', '/tasks', { token: member }).data;
  assert.ok(all.every((t) => t.projectId === 'project-alpha'));
  const combined = call('GET', '/tasks', { token: member, query: { status: 'In Progress', priority: 'High', assigneeId: 'user-member-002' } }).data;
  assert.deepEqual(combined.map((t) => t.id), ['task-004']);
  assert.deepEqual(call('GET', '/tasks', { token: member, query: { q: 'no such words here' } }).data, []);
  assertEnvelope(call('GET', '/tasks', { token: member, query: { status: '$ne' } }), 400, 'VALIDATION_ERROR');
});

test('TC-REPORT-01 summary counts and overdue total match the seeded data', () => {
  const { call, login } = setup();
  const summary = call('GET', '/projects/project-alpha/summary', { token: login('lead@example.test') }).data;
  assert.deepEqual(summary.counts, { 'To Do': 3, 'In Progress': 2, Done: 2 });
  assert.equal(summary.total, 7);
  assert.equal(summary.overdue, 1);
  assertEnvelope(call('GET', '/projects/project-beta/summary', { token: login('member@example.test') }), 403, 'FORBIDDEN');
});

test('TC-REPORT-02 CSV export escapes cells and neutralises formulas', () => {
  const { call, login } = setup();
  const res = call('GET', '/projects/project-alpha/tasks/export.csv', { token: login('lead@example.test') });
  assert.match(res.headers['content-type'], /text\/csv/);
  const lines = res.data.trim().split('\r\n');
  assert.equal(lines.length, 8);
  assert.ok(lines.some((line) => line.includes(`"'=HYPERLINK(""https://example.test"",""Export check"")"`)));
  for (const value of negatives.csvFormulaLikeValues) assert.ok(csvCell(value).replace(/^"/, '').startsWith("'"));
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
});

test('unknown routes return the error envelope and never a stack trace (PRJ-SR-006)', () => {
  const { call, login } = setup();
  assertEnvelope(call('GET', '/nope', { token: login('lead@example.test') }), 404, 'NOT_FOUND');
});


test('dashboard and summary use a validated local day; unread count scans once', () => {
  const { call, login } = setup(() => new Date('2026-10-15T19:00:00.000Z'));
  const token = login('member@example.test');
  const opts = { token, query: { today: '2026-10-16' } };
  const dashboard = call('GET', '/dashboard', opts).data;
  const summary = call('GET', '/projects/project-alpha/summary', opts).data;
  assert.equal(dashboard.projects.find((p) => p.projectId === 'project-alpha').overdue, summary.overdue);
  const count = call('GET', '/notifications/unread-count', { token }).data.unreadCount;
  assert.equal(typeof count, 'number');
  assert.equal(call('GET', '/notifications/unread-count', { token }).data.unreadCount, count);
});

test('unread badge creates due reminders and throttles subsequent scans', () => {
  const isolated = { ...seed, notifications: [], tasks: [{ ...tasks.find((task) => task.id === 'task-004'), dueDate: '2026-10-16' }] };
  const server = createMockServer({ seed: isolated, now: () => NOW });
  const token = server.handle('POST', '/auth/login', { body: { email: 'member@example.test', password: MOCK_PASSWORD } }).data.token;
  const first = server.handle('GET', '/notifications/unread-count', { token });
  assert.equal(first.data.unreadCount, 1);
  assert.equal(server.handle('GET', '/notifications/unread-count', { token }).data.unreadCount, 1);
});

test('a password change revokes earlier mock sessions and returns a replacement token', () => {
  const { call, login } = setup();
  const old = login('member@example.test');
  const changed = call('PATCH', '/users/me', { token: old, body: { currentPassword: MOCK_PASSWORD, newPassword: 'Rotated12345' } });
  assert.equal(changed.status, 200);
  assert.equal(typeof changed.data.token, 'string');
  assertEnvelope(call('GET', '/auth/me', { token: old }), 401, 'TOKEN_REVOKED');
  assert.equal(call('GET', '/auth/me', { token: changed.data.token }).status, 200);
  const renamed = call('PATCH', '/users/me', { token: changed.data.token, body: { name: 'Renamed' } });
  assert.equal(renamed.data.token, undefined);
});

test('Admin user management mirrors the API: list, filter, role change and last-admin guard', () => {
  const { call, login } = setup();
  const admin = login('admin@example.test');
  assertEnvelope(call('GET', '/users', { token: login('lead@example.test') }), 403, 'FORBIDDEN');
  const all = call('GET', '/users', { token: admin });
  assert.equal(all.data.total, users.length);
  assert.deepEqual(all.data.roleCounts, { Admin: 1, Lead: 1, Member: 4 });
  assert.equal(all.data.items.find((u) => u.id === 'user-lead-001').projectCount, 2);
  assert.ok(all.data.items.every((u) => !('password' in u)));
  assert.deepEqual(call('GET', '/users', { token: admin, query: { q: 'long.address' } }).data.items.map((u) => u.id), ['user-member-002']);
  assertEnvelope(call('GET', '/users', { token: admin, query: { role: 'Owner' } }), 400, 'VALIDATION_ERROR');

  const promoted = call('PATCH', '/users/user-outsider-001/role', { token: admin, body: { role: 'Lead' } });
  assert.equal(promoted.data.role, 'Lead');
  assert.equal(call('POST', '/projects', { token: login('outsider@example.test'), body: { name: 'Now allowed' } }).status, 201);
  assertEnvelope(call('PATCH', '/users/user-admin-001/role', { token: admin, body: { role: 'Member' } }), 409, 'LAST_ADMIN');
  assertEnvelope(call('PATCH', '/users/nobody/role', { token: admin, body: { role: 'Lead' } }), 404, 'NOT_FOUND');
});

test('removing a member drops their notifications for that project', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const member = login('member@example.test');
  assert.ok(call('GET', '/notifications', { token: member }).data.items.some((n) => n.projectId === 'project-alpha'));
  assert.equal(call('DELETE', '/projects/project-alpha/members/user-member-001', { token: lead }).status, 200);
  assert.equal(call('GET', '/notifications', { token: member }).data.items.some((n) => n.projectId === 'project-alpha'), false);
  assert.equal(call('GET', '/notifications/unread-count', { token: member }).data.unreadCount, 0);
});

test('project roles mirror the API: viewers read and comment, managers manage, owners transfer', () => {
  const { call, login } = setup();
  const viewer = login('viewer@example.test');
  const lead = login('lead@example.test');
  const roleOf = (list, id) => list.find((member) => member.id === id)?.projectRole;

  assert.equal(roleOf(call('GET', '/projects/project-alpha/members', { token: viewer }).data, 'user-viewer-001'), 'Viewer');
  assertEnvelope(call('PATCH', '/tasks/task-001/status', { token: viewer, body: { status: 'Done' } }), 403, 'FORBIDDEN');
  assert.equal(call('POST', '/tasks/task-001/comments', { token: viewer, body: { text: 'Noted.' } }).status, 201);
  assertEnvelope(call('PATCH', '/tasks/task-001', { token: lead, body: { assigneeIds: ['user-viewer-001'] } }), 400, 'VALIDATION_ERROR');

  // Lead is a Manager in Beta: may edit, may not delete or grant Manager.
  assert.equal(call('PATCH', '/projects/project-beta', { token: lead, body: { name: 'Beta 2' } }).status, 200);
  assertEnvelope(call('DELETE', '/projects/project-beta', { token: lead }), 403, 'FORBIDDEN');
  assertEnvelope(call('POST', '/projects/project-beta/members', { token: lead, body: { email: 'member@example.test', role: 'Manager' } }), 403, 'FORBIDDEN');
  assert.equal(roleOf(call('POST', '/projects/project-beta/members', { token: lead, body: { email: 'member@example.test', role: 'Viewer' } }).data, 'user-member-001'), 'Viewer');

  // Owner transfers Alpha; the old owner becomes a Manager and loses delete.
  const transferred = call('PATCH', '/projects/project-alpha/members/user-member-002', { token: lead, body: { role: 'Owner' } });
  assert.equal(roleOf(transferred.data, 'user-member-002'), 'Owner');
  assert.equal(roleOf(transferred.data, 'user-lead-001'), 'Manager');
  assertEnvelope(call('DELETE', '/projects/project-alpha', { token: lead }), 403, 'FORBIDDEN');
  assertEnvelope(call('DELETE', '/projects/project-alpha/members/user-member-002', { token: lead }), 400, 'VALIDATION_ERROR');
  // Leaving is open to any non-owner.
  assert.equal(call('DELETE', '/projects/project-alpha/members/user-viewer-001', { token: viewer }).status, 200);
});

test('deactivation mirrors the API: signs the user out, blocks sign-in and re-adding', () => {
  const { call, login } = setup();
  const admin = login('admin@example.test');
  const member = login('member@example.test');
  assertEnvelope(call('PATCH', '/users/user-admin-001/status', { token: admin, body: { active: false } }), 400, 'VALIDATION_ERROR');
  assert.equal(call('PATCH', '/users/user-member-001/status', { token: admin, body: { active: false } }).data.active, false);
  assertEnvelope(call('GET', '/auth/me', { token: member }), 401, 'ACCOUNT_DEACTIVATED');
  assertEnvelope(call('POST', '/auth/login', { body: { email: 'member@example.test', password: MOCK_PASSWORD } }), 403, 'ACCOUNT_DEACTIVATED');
  assert.deepEqual(call('GET', '/users', { token: admin, query: { status: 'deactivated' } }).data.items.map((u) => u.id), ['user-member-001']);
  const lead = login('lead@example.test');
  call('DELETE', '/projects/project-alpha/members/user-member-001', { token: lead });
  assertEnvelope(call('POST', '/projects/project-alpha/members', { token: lead, body: { email: 'member@example.test' } }), 400, 'VALIDATION_ERROR');
  assert.equal(call('PATCH', '/users/user-member-001/status', { token: admin, body: { active: true } }).status, 200);
  assert.equal(call('POST', '/auth/login', { body: { email: 'member@example.test', password: MOCK_PASSWORD } }).status, 200);
});

test('completedAt mirrors the API: stamped on Done by any route, kept on re-Done, cleared on reopen', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const done = call('PATCH', '/tasks/task-001/status', { token: lead, body: { status: 'Done' } });
  assert.equal(done.status, 200);
  assert.equal(done.data.completedAt, NOW.toISOString());
  assert.equal(call('PATCH', '/tasks/task-001/status', { token: lead, body: { status: 'Done' } }).data.completedAt, NOW.toISOString());
  assert.equal(call('PATCH', '/tasks/task-001/status', { token: lead, body: { status: 'To Do' } }).data.completedAt, null);

  // A full update: renaming leaves a completion alone; reopening clears it.
  const finished = tasks.find((task) => task.id === 'task-006');
  assert.equal(call('PATCH', '/tasks/task-006', { token: lead, body: { title: 'Renamed' } }).data.completedAt, finished.completedAt);
  assert.equal(call('PATCH', '/tasks/task-006', { token: lead, body: { status: 'In Progress' } }).data.completedAt, null);
  assert.equal(call('PATCH', '/tasks/task-002', { token: lead, body: { status: 'Done' } }).data.completedAt, NOW.toISOString());

  const created = call('POST', '/projects/project-alpha/tasks', { token: lead, body: { title: 'Logged late', status: 'Done' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.completedAt, NOW.toISOString());
  assert.equal(call('POST', '/projects/project-alpha/tasks', { token: lead, body: { title: 'Open' } }).data.completedAt, null);
});

test('checklists mirror the API: owners and members edit, viewers cannot, 50-item cap', () => {
  const { call, login } = setup();
  const lead = login('lead@example.test');
  const member = login('member@example.test');
  const viewer = login('viewer@example.test');
  assert.equal(call('GET', '/tasks/task-002', { token: member }).data.checklist.length, 4);

  const added = call('POST', '/tasks/task-002/checklist', { token: lead, body: { text: '  Empty column state ' } });
  assert.equal(added.status, 201);
  const item = added.data.checklist.at(-1);
  assert.deepEqual([item.text, item.done], ['Empty column state', false]);
  assert.equal(call('PATCH', `/tasks/task-002/checklist/${item.id}`, { token: member, body: { done: true } }).data.checklist.at(-1).done, true);

  const memberItem = call('POST', '/tasks/task-002/checklist', { token: member, body: { text: 'Member step' } }).data.checklist.at(-1);
  assert.equal(call('PATCH', `/tasks/task-002/checklist/${memberItem.id}`, { token: member, body: { text: 'Renamed by member' } }).status, 200);
  assert.equal(call('DELETE', `/tasks/task-002/checklist/${memberItem.id}`, { token: member }).status, 200);
  const viewerAdd = call('POST', '/tasks/task-002/checklist', { token: viewer, body: { text: 'Nope' } });
  assertEnvelope(viewerAdd, 403, 'FORBIDDEN');
  assert.equal(viewerAdd.data.message, 'Viewers cannot edit tasks.');
  assertEnvelope(call('PATCH', `/tasks/task-002/checklist/${item.id}`, { token: viewer, body: { done: false } }), 403, 'FORBIDDEN');
  assertEnvelope(call('PATCH', `/tasks/task-002/checklist/${item.id}`, { token: lead, body: { done: 'yes' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('POST', '/tasks/task-002/checklist', { token: lead, body: { text: '   ' } }), 400, 'VALIDATION_ERROR');
  assertEnvelope(call('PATCH', '/tasks/task-002/checklist/missing', { token: lead, body: { done: true } }), 404, 'NOT_FOUND');

  assert.equal(call('PATCH', `/tasks/task-002/checklist/${item.id}`, { token: lead, body: { text: 'Renamed' } }).data.checklist.at(-1).text, 'Renamed');
  assert.equal(call('DELETE', `/tasks/task-002/checklist/${item.id}`, { token: lead }).data.checklist.length, 4);

  const fresh = call('POST', '/projects/project-alpha/tasks', { token: lead, body: { title: 'Long one' } }).data;
  assert.deepEqual(fresh.checklist, []);
  for (let i = 0; i < 50; i += 1) call('POST', `/tasks/${fresh.id}/checklist`, { token: lead, body: { text: `Step ${i}` } });
  assertEnvelope(call('POST', `/tasks/${fresh.id}/checklist`, { token: lead, body: { text: 'One too many' } }), 400, 'VALIDATION_ERROR');
});

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

test('TC-PROJ-01 leads create projects; members cannot; outsiders see no projects', () => {
  const { call, login } = setup();
  const created = call('POST', '/projects', { token: login('lead@example.test'), body: { name: 'Gamma', description: 'New' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.memberIds, ['user-lead-001']);
  assertEnvelope(call('POST', '/projects', { token: login('member@example.test'), body: { name: 'Nope' } }), 403, 'FORBIDDEN');
  assert.deepEqual(call('GET', '/projects', { token: login('outsider@example.test') }).data, []);
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
  assertEnvelope(call('POST', '/projects/project-alpha/tasks', { token: login('member@example.test'), body: { title: 'x' } }), 403, 'FORBIDDEN');
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

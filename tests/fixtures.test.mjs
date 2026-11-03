// Synthetic fixture integrity checks (STP §5.4 test data and isolation).
import test from 'node:test';
import assert from 'node:assert/strict';
import users from '../fixtures/users.json' with { type: 'json' };
import projects from '../fixtures/projects.json' with { type: 'json' };
import tasks from '../fixtures/tasks.json' with { type: 'json' };
import comments from '../fixtures/comments.json' with { type: 'json' };
import notifications from '../fixtures/notifications.json' with { type: 'json' };
import negatives from '../fixtures/negative-inputs.json' with { type: 'json' };

const byId = (list) => new Map(list.map((item) => [item.id, item]));
const userIds = byId(users);
const projectIds = byId(projects);
const taskIds = byId(tasks);

test('fixtures use unique ids and synthetic example.test emails only', () => {
  for (const list of [users, projects, tasks, comments, notifications]) {
    assert.equal(new Set(list.map((item) => item.id)).size, list.length);
  }
  assert.ok(users.every((u) => u.email.endsWith('@example.test')));
  assert.ok(users.every((u) => !('password' in u) && !('passwordHash' in u)));
});

test('synthetic fixtures include all required roles and an outsider (TM-F-021, PRJ-SR-003)', () => {
  assert.deepEqual(new Set(users.map((u) => u.role)), new Set(['Admin', 'Lead', 'Member']));
  const outsider = users.find((u) => u.email === 'outsider@example.test');
  assert.ok(outsider);
  assert.ok(projects.every((p) => !p.memberIds.includes(outsider.id)));
});

test('task fixtures cover all board statuses and priorities (TM-F-012, TM-F-023)', () => {
  assert.deepEqual(new Set(tasks.map((t) => t.status)), new Set(['To Do', 'In Progress', 'Done']));
  assert.deepEqual(new Set(tasks.map((t) => t.priority)), new Set(['High', 'Medium', 'Low']));
});

test('tasks cover past and future due dates and multiple assignees', () => {
  const reference = '2026-10-16';
  assert.ok(tasks.some((t) => t.dueDate < reference && t.status !== 'Done'));
  assert.ok(tasks.some((t) => t.dueDate > reference));
  assert.ok(tasks.some((t) => t.assigneeIds.length > 1));
  assert.ok(tasks.some((t) => t.assigneeIds.length === 0));
});

test('every reference resolves and every assignee is a member of the task project (TM-F-022)', () => {
  for (const project of projects) {
    assert.ok(userIds.has(project.ownerId));
    assert.ok(project.memberIds.includes(project.ownerId));
    project.memberIds.forEach((id) => assert.ok(userIds.has(id), `${project.id} member ${id}`));
  }
  for (const task of tasks) {
    const project = projectIds.get(task.projectId);
    assert.ok(project, `${task.id} project`);
    task.assigneeIds.forEach((id) => assert.ok(project.memberIds.includes(id), `${task.id} assignee ${id}`));
  }
  for (const comment of comments) {
    const task = taskIds.get(comment.taskId);
    assert.ok(task, `${comment.id} task`);
    assert.ok(projectIds.get(task.projectId).memberIds.includes(comment.authorId), `${comment.id} author`);
  }
  for (const notification of notifications) {
    assert.ok(userIds.has(notification.userId));
    assert.ok(taskIds.has(notification.taskId));
  }
});

test('notifications cover both types and read/unread states (TM-F-030, TM-F-031)', () => {
  assert.deepEqual(new Set(notifications.map((n) => n.type)), new Set(['assignment', 'due-date']));
  assert.deepEqual(new Set(notifications.map((n) => n.read)), new Set([true, false]));
});

test('negative fixtures cover injection, XSS, CSV formula and JWT cases', () => {
  assert.ok(negatives.noSqlInjectionLike);
  assert.ok(negatives.xssLookingComment.includes('<script>'));
  assert.ok(negatives.csvFormulaLikeValues.some((v) => v.startsWith('=')));
  assert.ok(comments.some((c) => c.text === negatives.xssLookingComment));
  assert.ok(tasks.some((t) => t.title.startsWith('=')));
  assert.equal(negatives.jwtCases.length, 2);
  assert.ok(users.some((u) => u.email === negatives.duplicateEmail));
});

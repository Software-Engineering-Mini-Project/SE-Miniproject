// Task activity history (src/lib/activity.js, issue #75): which entries a change writes and how
// they read.
import assert from 'node:assert/strict';
import test from 'node:test';
import { commentExcerpt, describeActivity, seedActivities, taskChangeActivities, taskSnapshot } from '../src/lib/activity.js';

const base = taskSnapshot({
  title: 'Fix login', description: '', status: 'To Do', priority: 'Medium', dueDate: null, type: 'Task',
  storyPoints: null, epicId: null, assigneeIds: ['mina'], labels: ['ui'],
});

test('one entry per changed field, none when nothing changed', () => {
  assert.deepEqual(taskChangeActivities(base, { ...base }), []);
  const changed = taskChangeActivities(base, {
    ...base, status: 'In Progress', priority: 'High', dueDate: '2026-11-20', storyPoints: 3, description: 'More',
    assigneeIds: ['lena'], labels: ['ui', 'api'],
  });
  assert.deepEqual(changed.map((entry) => entry.action), ['status', 'priority', 'dueDate', 'storyPoints', 'description', 'assignees', 'labels']);
  assert.deepEqual(changed.find((entry) => entry.action === 'status').details, { from: 'To Do', to: 'In Progress' });
  assert.deepEqual(changed.find((entry) => entry.action === 'assignees').details, { added: ['lena'], removed: ['mina'] });
  assert.deepEqual(changed.find((entry) => entry.action === 'labels').details, { added: ['api'], removed: [] });
  // Reordering a list is not a change.
  assert.deepEqual(taskChangeActivities({ ...base, labels: ['a', 'b'] }, { ...base, labels: ['b', 'a'] }), []);
});

test('entries read as sentences', () => {
  const names = { mina: 'Mina Member', lena: 'Lena Lead', sam: 'Sam' };
  const say = (action, details) => describeActivity({ action, details }, { taskKey: 'ALPHA-12', nameOf: (id) => names[id], taskTitleOf: (id) => (id === 'e1' ? 'Board' : null) });
  assert.equal(`Mina ${say('status', { from: 'To Do', to: 'In Progress' })}`, 'Mina moved ALPHA-12 from To Do to In Progress');
  assert.equal(say('created', {}), 'created ALPHA-12');
  assert.equal(say('priority', { from: 'Medium', to: 'High' }), 'changed the priority of ALPHA-12 from Medium to High');
  assert.equal(say('dueDate', { from: null, to: '2026-11-20' }), 'set ALPHA-12 due 2026-11-20');
  assert.equal(say('dueDate', { from: '2026-11-20', to: null }), 'removed the due date of ALPHA-12');
  assert.equal(say('type', { from: 'Task', to: 'Bug' }), 'changed ALPHA-12 from Task to Bug');
  assert.equal(say('storyPoints', { from: null, to: 1 }), 'estimated ALPHA-12 at 1 point');
  assert.equal(say('storyPoints', { from: 3, to: 5 }), 'changed the estimate of ALPHA-12 from 3 to 5 points');
  assert.equal(say('assignees', { added: ['mina', 'lena'], removed: [] }), 'assigned Mina Member and Lena Lead to ALPHA-12');
  assert.equal(say('assignees', { added: ['sam'], removed: ['mina'] }), 'assigned Sam to ALPHA-12 and unassigned Mina Member');
  assert.equal(say('assignees', { added: [], removed: ['mina'] }), 'unassigned Mina Member from ALPHA-12');
  assert.equal(say('labels', { added: ['api'], removed: ['ui', 'ux'] }), 'added the label api and removed the labels ui and ux on ALPHA-12');
  assert.equal(say('epicId', { from: null, to: 'e1' }), 'added ALPHA-12 to the epic "Board"');
  assert.equal(say('epicId', { from: 'e1', to: null }), 'took ALPHA-12 out of "Board"');
  assert.equal(say('checklist.check', { text: 'Write tests', done: true }), 'ticked off "Write tests" on ALPHA-12');
  assert.equal(say('comment.add', { excerpt: 'Looks good' }), 'commented on ALPHA-12: "Looks good"');
  assert.equal(say('comment.add', { excerpt: null }), 'commented on ALPHA-12', 'a deleted comment leaves no text behind');
  assert.equal(describeActivity({ action: 'created', details: {} }), 'created this task');
});

test('comment excerpts and seeded history', () => {
  assert.equal(commentExcerpt('  a\n\nb  '), 'a b');
  assert.equal(commentExcerpt('x'.repeat(200)).length, 120);
  const entries = seedActivities({
    tasks: [{ id: 't1', projectId: 'p1', title: 'T', createdAt: '2026-10-01T00:00:00Z' }],
    comments: [{ id: 'c1', taskId: 't1', authorId: 'u2', text: 'Hi', createdAt: '2026-10-02T00:00:00Z' }, { id: 'c2', taskId: 'gone', authorId: 'u2', text: 'x', createdAt: '2026-10-02T00:00:00Z' }],
    projects: [{ id: 'p1', ownerId: 'u1' }],
  });
  assert.deepEqual(entries.map((e) => [e.action, e.actorId, e.taskId]), [['created', 'u1', 't1'], ['comment.add', 'u2', 't1']]);
});

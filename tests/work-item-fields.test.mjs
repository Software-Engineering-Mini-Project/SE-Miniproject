// Work-item types, story points, labels and epics (src/lib/work-items.js, issue #74).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  epicProgress,
  epicRuleErrors,
  labelError,
  normalizeLabel,
  projectLabels,
  readWorkItemFields,
  withWorkItemDefaults,
} from '../src/lib/work-items.js';

test('create fills defaults; update reads only what was sent', () => {
  assert.deepEqual(readWorkItemFields({}, { create: true }), {
    values: { type: 'Task', storyPoints: null, labels: [], epicId: null },
    errors: {},
  });
  assert.deepEqual(readWorkItemFields({ storyPoints: 5 }), { values: { storyPoints: 5 }, errors: {} });
  assert.deepEqual(readWorkItemFields({}).values, {});
});

test('types, points and labels are validated', () => {
  assert.ok(readWorkItemFields({ type: 'Feature' }).errors.type);
  assert.ok(readWorkItemFields({ type: { $ne: null } }).errors.type);
  for (const bad of [4, '3', 0, 100, 2.5]) assert.ok(readWorkItemFields({ storyPoints: bad }).errors.storyPoints, `${bad}`);
  assert.equal(readWorkItemFields({ storyPoints: null }).values.storyPoints, null);
  assert.deepEqual(readWorkItemFields({ labels: [' Front End ', '#front-end', 'API'] }).values.labels, ['front-end', 'api']);
  assert.ok(readWorkItemFields({ labels: 'frontend' }).errors.labels);
  assert.ok(readWorkItemFields({ labels: [{ $gt: '' }] }).errors.labels);
  assert.ok(readWorkItemFields({ labels: ['x'.repeat(31)] }).errors.labels);
  assert.ok(readWorkItemFields({ labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }).errors.labels);
  assert.ok(readWorkItemFields({ epicId: 12 }).errors.epicId);
  assert.equal(normalizeLabel('#UI'), 'ui');
  assert.equal(labelError('ok-label'), null);
  assert.ok(labelError('-dash-first'));
});

test('epic rules: same project, never nested, and an epic keeps its type while it has items', () => {
  const epic = { id: 'e1', type: 'Epic', projectId: 'p1' };
  const next = (fields) => ({ id: 't1', projectId: 'p1', type: 'Story', epicId: 'e1', ...fields });
  assert.deepEqual(epicRuleErrors({ next: next(), epic }), {});
  assert.match(epicRuleErrors({ next: next({ type: 'Epic' }), epic }).epicId, /cannot belong to another epic/);
  assert.match(epicRuleErrors({ next: next(), epic: { ...epic, projectId: 'p2' } }).epicId, /from this project/);
  assert.match(epicRuleErrors({ next: next(), epic: { ...epic, type: 'Task' } }).epicId, /from this project/);
  assert.match(epicRuleErrors({ next: next(), epic: null }).epicId, /from this project/);
  assert.match(epicRuleErrors({ current: { id: 't1', type: 'Task' }, next: next({ epicId: 't1' }), epic }).epicId, /own epic/);
  assert.match(
    epicRuleErrors({ current: { id: 'e1', type: 'Epic' }, next: { id: 'e1', projectId: 'p1', type: 'Task', epicId: null }, childCount: 2 }).type,
    /Move the 2 items out/,
  );
  assert.deepEqual(epicRuleErrors({ current: { id: 'e1', type: 'Epic' }, next: { id: 'e1', projectId: 'p1', type: 'Task', epicId: null }, childCount: 0 }), {});
});

test('epic progress, project labels and defaults for old records', () => {
  const tasks = [
    { id: 'a', epicId: 'e', status: 'Done', storyPoints: 3, labels: ['ui'] },
    { id: 'b', epicId: 'e', status: 'In Progress', storyPoints: 5, labels: ['ui', 'api'] },
    { id: 'c', epicId: 'e', status: 'To Do', storyPoints: null, labels: [] },
    { id: 'd', epicId: null, status: 'Done', labels: ['api', 'zeta'] },
  ];
  assert.deepEqual(epicProgress('e', tasks), { total: 3, done: 1, inProgress: 1, points: 8, donePoints: 3, percent: 33 });
  assert.deepEqual(epicProgress('none', tasks).percent, 0);
  assert.deepEqual(projectLabels(tasks).map((l) => l.label), ['api', 'ui', 'zeta']);
  assert.deepEqual(withWorkItemDefaults({ id: 'x', type: 'Odd', storyPoints: 4 }), { id: 'x', type: 'Task', storyPoints: null, labels: [], epicId: null, sprintId: null, rank: null });
});

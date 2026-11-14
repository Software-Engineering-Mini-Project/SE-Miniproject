// Burndown, sprint report and velocity (issue #77), worked out from the activity history.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import projects from '../fixtures/projects.json' with { type: 'json' };
import sprints from '../fixtures/sprints.json' with { type: 'json' };
import tasks from '../fixtures/tasks.json' with { type: 'json' };
import comments from '../fixtures/comments.json' with { type: 'json' };
import { seedActivities } from '../src/lib/activity.js';
import { buildSprintReport, velocity, velocityForecast } from '../src/lib/sprint-report.js';

const activities = seedActivities({ tasks, comments, projects, sprints });
const alpha = tasks.filter((task) => task.projectId === 'project-alpha');
const [sprint1, sprint2] = sprints;

test('the seeded completed sprint: committed, finished, carried over and its burndown in points', () => {
  const report = buildSprintReport({ sprint: sprint1, tasks: alpha, activities, today: '2026-10-16' });
  assert.equal(report.unit, 'points');
  assert.deepEqual(report.committed, { taskIds: ['task-001', 'task-006', 'task-010'], count: 3, points: 4 });
  assert.deepEqual(report.completed.taskIds, ['task-006', 'task-010']);
  assert.deepEqual(report.carriedOver, { taskIds: ['task-001'], count: 1, points: 2, movedTo: 'sprint-alpha-2' });
  assert.equal(report.added.count, 0);
  // 4 points at the start; task-006 (2 points) finished on 11 Oct; task-010 has no estimate.
  assert.deepEqual(report.days.map((day) => [day.date, day.remaining]), [
    ['2026-10-04', 4], ['2026-10-05', 4], ['2026-10-06', 4], ['2026-10-07', 4], ['2026-10-08', 4],
    ['2026-10-09', 4], ['2026-10-10', 4], ['2026-10-11', 2], ['2026-10-12', 2], ['2026-10-13', 2],
  ]);
  assert.equal(report.days[0].ideal, 4);
  assert.equal(report.days.at(-1).ideal, 0);
});

test('the seeded active sprint: the burndown stops at today, the ideal line runs to the end date', () => {
  const report = buildSprintReport({ sprint: sprint2, tasks: alpha, activities, today: '2026-10-16' });
  assert.equal(report.committed.points, 10);
  assert.equal(report.days.length, 14);
  assert.deepEqual(report.days.slice(0, 4).map((day) => day.remaining), [10, 10, 10, null]);
  assert.deepEqual(report.days.map((day) => day.ideal).slice(0, 2), [10, 9.2]);
});

test('scope changes and finishing during a sprint come from the activity history', () => {
  const sprint = { id: 's9', projectId: 'p', state: 'active', startDate: '2026-11-02', endDate: '2026-11-06', startedAt: '2026-11-02T09:00:00Z', committed: { taskIds: ['a', 'b'], points: 8 } };
  const list = [
    { id: 'a', sprintId: 's9', status: 'Done', storyPoints: 5, completedAt: '2026-11-03T12:00:00Z' },
    { id: 'b', sprintId: null, status: 'To Do', storyPoints: 3 },
    { id: 'c', sprintId: 's9', status: 'To Do', storyPoints: 2 },
    { id: 'd', sprintId: 's9', status: 'In Progress', storyPoints: null },
  ];
  const history = [
    { taskId: 'a', action: 'sprint', details: { from: null, to: 's9' }, createdAt: '2026-11-01T10:00:00Z' },
    { taskId: 'b', action: 'sprint', details: { from: null, to: 's9' }, createdAt: '2026-11-01T10:00:00Z' },
    { taskId: 'a', action: 'status', details: { from: 'In Progress', to: 'Done' }, createdAt: '2026-11-03T12:00:00Z' },
    { taskId: 'c', action: 'sprint', details: { from: null, to: 's9' }, createdAt: '2026-11-04T08:00:00Z' },
    { taskId: 'b', action: 'sprint', details: { from: 's9', to: null }, createdAt: '2026-11-05T08:00:00Z' },
    { taskId: 'd', action: 'sprint', details: { from: null, to: 's9' }, createdAt: '2026-11-05T09:00:00Z' },
  ];
  const report = buildSprintReport({ sprint, tasks: list, activities: history, today: '2026-11-05' });
  assert.deepEqual(report.added.taskIds, ['c', 'd']);
  assert.deepEqual(report.removed.taskIds, ['b']);
  assert.deepEqual(report.completed.taskIds, ['a']);
  // 8 → 8 → 3 (a done) → 5 (c added) → 2 (b removed; d has no estimate) → not yet.
  assert.deepEqual(report.days.map((day) => day.remaining), [8, 3, 5, 2, null]);
  assert.deepEqual(report.days.map((day) => day.ideal), [8, 6, 4, 2, 0]);

  // Without any story points the burndown counts items instead.
  const unestimated = list.map((task) => ({ ...task, storyPoints: null }));
  const byCount = buildSprintReport({ sprint: { ...sprint, committed: { taskIds: ['a', 'b'], points: 0 } }, tasks: unestimated, activities: history, today: '2026-11-05' });
  assert.equal(byCount.unit, 'items');
  assert.deepEqual(byCount.days.map((day) => day.remaining), [2, 1, 2, 2, null]);
});

test('velocity: points finished per completed sprint, the average of the last three, and the forecast by velocity', () => {
  const done = (id, completedAt, committed, completed) => ({
    id, name: id, state: 'completed', completedAt, committed: { taskIds: [], points: committed },
    report: { completed: { taskIds: [], count: 1, points: completed }, unfinished: { taskIds: [], count: 0, points: 0 }, movedTo: null },
  });
  const result = velocity([done('s3', '2026-10-30', 10, 9), done('s1', '2026-10-02', 8, 4), done('s2', '2026-10-16', 10, 11), { id: 's4', state: 'active' }]);
  assert.deepEqual(result.sprints.map((item) => [item.id, item.completedPoints]), [['s1', 4], ['s2', 11], ['s3', 9]]);
  assert.equal(result.average, 8);
  assert.equal(velocity([]).average, null);
  assert.deepEqual(velocityForecast({ average: 8, remainingPoints: 20, unestimated: 2 }), { sprints: 3, remainingPoints: 20, unestimated: 2, average: 8 });
  assert.equal(velocityForecast({ average: null, remainingPoints: 20 }), null);
});

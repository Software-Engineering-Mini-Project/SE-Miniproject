// Backlog and sprint rules shared by the API, the mock API and the UI (issue #76).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RANK_STEP,
  byRank,
  completionPlan,
  leavesCompletedSprint,
  nextRank,
  nextSprintDefaults,
  orderSprints,
  rankBetween,
  readSprintFields,
  renumberRanks,
  sprintLengthDays,
  sprintTargetError,
  sprintTotals,
} from '../src/lib/sprints.js';
import { describeActivity } from '../src/lib/activity.js';

test('sprint fields: dates are required on create, the end is not before the start, and text is bounded', () => {
  assert.deepEqual(readSprintFields({}, { create: true }).errors, { startDate: 'Choose a start date.', endDate: 'Choose an end date.' });
  const ok = readSprintFields({ name: '  Sprint 9 ', startDate: '2026-11-01', endDate: '2026-11-14', goal: ' Ship ' }, { create: true });
  assert.deepEqual(ok, { values: { name: 'Sprint 9', goal: 'Ship', startDate: '2026-11-01', endDate: '2026-11-14' }, errors: {} });
  assert.equal(readSprintFields({ startDate: '2026-11-14', endDate: '2026-11-01' }, { create: true }).errors.endDate, 'The sprint must end on or after its start date.');
  assert.equal(readSprintFields({ startDate: '2026-02-30', endDate: '2026-03-01' }, { create: true }).errors.startDate, 'Enter a valid date.');
  assert.equal(readSprintFields({ name: ' ' }).errors.name, 'Give the sprint a name.');
  assert.equal(readSprintFields({ goal: 'x'.repeat(501) }).errors.goal, 'Use 500 characters or fewer.');
  // An edit is checked against the dates it does not change.
  assert.ok(readSprintFields({ endDate: '2026-10-01' }, { current: { startDate: '2026-10-05', endDate: '2026-10-18' } }).errors.endDate);
  assert.equal(sprintLengthDays('2026-10-14', '2026-10-27'), 14);
});

test('ranking: midpoints between neighbours, ends extend, crowded gaps ask for renumbering', () => {
  assert.deepEqual(rankBetween(null, null), { rank: RANK_STEP, crowded: false });
  assert.equal(rankBetween(1024, null).rank, 2048);
  assert.equal(rankBetween(null, 1024).rank, 0);
  assert.equal(rankBetween(1024, 2048).rank, 1536);
  assert.equal(rankBetween(1, 1 + 1e-9).crowded, true);
  const tasks = [
    { id: 'c', rank: null, createdAt: '2026-10-03' },
    { id: 'a', rank: 2048 },
    { id: 'b', rank: 1024 },
    { id: 'd', rank: null, createdAt: '2026-10-01' },
  ];
  assert.deepEqual(byRank(tasks).map((task) => task.id), ['b', 'a', 'd', 'c'], 'ranked first, then unranked by age');
  assert.deepEqual(renumberRanks(tasks), [{ id: 'b', rank: 1024 }, { id: 'a', rank: 2048 }, { id: 'd', rank: 3072 }, { id: 'c', rank: 4096 }]);
  assert.equal(nextRank(tasks), 3072);
  assert.equal(nextRank([]), RANK_STEP);
});

test('completing: finished work stays as the record, unfinished work moves on with its points counted', () => {
  const tasks = [
    { id: 't1', status: 'Done', storyPoints: 3 },
    { id: 't2', status: 'In Progress', storyPoints: 5 },
    { id: 't3', status: 'To Do', storyPoints: null },
  ];
  assert.deepEqual(sprintTotals(tasks), { count: 3, done: 1, points: 8, donePoints: 3 });
  assert.deepEqual(completionPlan(tasks, 'sprint-9'), {
    moveIds: ['t2', 't3'],
    report: { completed: { taskIds: ['t1'], count: 1, points: 3 }, unfinished: { taskIds: ['t2', 't3'], count: 2, points: 5 }, movedTo: 'sprint-9' },
  });
  assert.equal(completionPlan([], undefined).report.movedTo, null);
  assert.equal(leavesCompletedSprint({ state: 'completed' }, 'Done', 'In Progress'), true);
  assert.equal(leavesCompletedSprint({ state: 'active' }, 'Done', 'In Progress'), false);
  assert.equal(sprintTargetError({ projectId: 'p1', state: 'completed' }, 'p1'), 'That sprint is complete. Choose a planned or active sprint, or the backlog.');
  assert.equal(sprintTargetError({ projectId: 'p2', state: 'planned' }, 'p1'), 'Choose a sprint from this project.');
  assert.equal(sprintTargetError({ projectId: 'p1', state: 'active' }, 'p1'), null);
});

test('defaults and order: the next sprint follows the last one; active first, then planned, then completed', () => {
  const sprints = [
    { id: 's1', number: 1, state: 'completed', endDate: '2026-10-13', completedAt: '2026-10-13T17:00:00Z' },
    { id: 's2', number: 2, state: 'active', startDate: '2026-10-14', endDate: '2026-10-27' },
  ];
  assert.deepEqual(nextSprintDefaults({ sprints, projectKey: 'ALPHA', today: '2026-10-16' }), { name: 'ALPHA Sprint 3', startDate: '2026-10-28', endDate: '2026-11-10' });
  assert.deepEqual(nextSprintDefaults({ sprints: [], projectName: 'Website', today: '2026-10-16' }), { name: 'Website Sprint 1', startDate: '2026-10-16', endDate: '2026-10-29' });
  assert.deepEqual(orderSprints([...sprints, { id: 's3', number: 3, state: 'planned', startDate: '2026-10-28' }]).map((sprint) => sprint.id), ['s2', 's3', 's1']);
  const name = (id) => ({ s1: 'ALPHA Sprint 1', s2: 'ALPHA Sprint 2' })[id];
  assert.equal(describeActivity({ action: 'sprint', details: { from: null, to: 's1' } }, { taskKey: 'ALPHA-1', sprintNameOf: name }), 'moved ALPHA-1 from the backlog to "ALPHA Sprint 1"');
  assert.equal(describeActivity({ action: 'sprint', details: { from: 's1', to: 's2' } }, { taskKey: 'ALPHA-1', sprintNameOf: name }), 'moved ALPHA-1 from "ALPHA Sprint 1" to "ALPHA Sprint 2"');
  assert.equal(describeActivity({ action: 'sprint', details: { from: 's2', to: null } }, { taskKey: 'ALPHA-1', sprintNameOf: name }), 'moved ALPHA-1 out of "ALPHA Sprint 2" to the backlog');
});

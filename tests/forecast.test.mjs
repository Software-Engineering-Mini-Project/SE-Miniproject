// Delivery forecast (src/lib/forecast.js): Monte Carlo over completion history.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_COMPLETIONS,
  dailyThroughput,
  forecastProject,
  riskLevel,
  seededRandom,
  weeklyThroughput,
  workQueue,
} from '../src/lib/forecast.js';

const TODAY = '2026-11-06';
const DAY = 86_400_000;
const daysFrom = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// Noon UTC lands on the same calendar day in every time zone from UTC-11 to UTC+11.
const doneOn = (n, id = `done-${n}`) => ({ id, status: 'Done', completedAt: `${daysFrom(n)}T12:00:00.000Z` });
const open = (id, dueIn, extra = {}) => ({ id, status: 'To Do', priority: 'Medium', dueDate: dueIn === null ? null : daysFrom(dueIn), createdAt: '2026-10-01T00:00:00Z', ...extra });

test('daily and weekly throughput count completions inside the window only', () => {
  const tasks = [doneOn(0), doneOn(-1), doneOn(-1, 'b'), doneOn(-41), doneOn(-42), { id: 'x', status: 'In Progress', completedAt: null }];
  const daily = dailyThroughput(tasks, TODAY, 42);
  assert.equal(daily.length, 42);
  assert.equal(daily[41], 1);
  assert.equal(daily[40], 2);
  assert.equal(daily[0], 1, 'day -41 is the oldest day in the window; day -42 is outside');
  assert.deepEqual(weeklyThroughput(tasks, TODAY).map((week) => week.count), [1, 0, 0, 0, 0, 3]);
  assert.equal(weeklyThroughput(tasks, TODAY).at(-1).weekEnding, TODAY);
});

test('the work queue: earliest due first, work in progress before new work, then priority', () => {
  const queue = workQueue([
    open('later', 9),
    open('no-date', null),
    open('soon-low', 2, { priority: 'Low' }),
    open('soon-high', 2, { priority: 'High' }),
    open('soon-wip', 2, { status: 'In Progress', priority: 'Low' }),
    doneOn(-1),
  ]);
  assert.deepEqual(queue.map((task) => task.id), ['soon-wip', 'soon-high', 'soon-low', 'later', 'no-date']);
});

test('empty, complete and not-enough-history states', () => {
  assert.equal(forecastProject([], { today: TODAY }).state, 'empty');
  assert.equal(forecastProject([doneOn(-1), doneOn(-2), doneOn(-3)], { today: TODAY }).state, 'complete');
  const thin = forecastProject([open('a', 3), doneOn(-1), doneOn(-60)], { today: TODAY });
  assert.equal(thin.state, 'insufficient');
  assert.equal(thin.completedInWindow, 1);
  assert.ok(thin.completedInWindow < MIN_COMPLETIONS);
  assert.equal(thin.risk.size, 0);
});

test('with exactly one completion every day, finish dates and due-date risk are exact', () => {
  const history = Array.from({ length: 42 }, (_, i) => doneOn(-i, `h${i}`));
  const tasks = [...history, open('t1', 0), open('t2', 1), open('t3', 2), open('t4', 2), open('t5', 30), open('t6', -3)];
  const result = forecastProject(tasks, { today: TODAY, simulations: 500 });
  assert.equal(result.state, 'ready');
  assert.equal(result.remaining, 6);
  assert.equal(result.averagePerWeek, 7);
  // One task a day starting today: the sixth finishes five days from now, in every simulation.
  assert.deepEqual(result.finish, { p50: daysFrom(5), p85: daysFrom(5), p95: daysFrom(5) });
  // Queue: t6 (overdue) day 0, t1 day 1 (due day 0: late), t2 day 2 (due 1: late),
  // t3 day 3, t4 day 4 (due 2: late), t5 day 5 (due 30: on track).
  assert.equal(result.risk.has('t6'), false, 'overdue tasks are not forecast');
  assert.deepEqual([...result.risk.keys()].sort(), ['t1', 't2', 't3', 't4', 't5']);
  assert.equal(result.risk.get('t1').probability, 0);
  assert.equal(result.risk.get('t5').probability, 1);
  assert.equal(result.risk.get('t5').level, 'on-track');
  assert.equal(result.risk.get('t1').level, 'at-risk');
  assert.equal(result.risk.get('t1').queuePosition, 2);
});

test('variable throughput gives ordered percentiles and is deterministic for a seed', () => {
  const history = [doneOn(0), doneOn(-3), doneOn(-3, 'x'), doneOn(-10), doneOn(-17), doneOn(-25), doneOn(-30)];
  const tasks = [...history, ...Array.from({ length: 8 }, (_, i) => open(`o${i}`, 5 + i * 4))];
  const first = forecastProject(tasks, { today: TODAY });
  const second = forecastProject(tasks, { today: TODAY });
  assert.equal(first.state, 'ready');
  assert.deepEqual(first.finish, second.finish);
  assert.deepEqual([...first.risk.entries()], [...second.risk.entries()]);
  assert.ok(first.finish.p50 <= first.finish.p85 && first.finish.p85 <= first.finish.p95);
  assert.ok(first.finish.p50 > TODAY);
  assert.equal(first.risk.size, 8);
  assert.ok([...first.risk.values()].every((entry) => entry.probability >= 0 && entry.probability <= 1));
  // The last task in the queue keeps its place when its due date moves later, so its chance of
  // making it can only grow.
  const relaxed = forecastProject(tasks.map((task) => (task.id === 'o7' ? { ...task, dueDate: daysFrom(90) } : task)), { today: TODAY });
  assert.equal(relaxed.risk.get('o7').queuePosition, 8);
  assert.ok(relaxed.risk.get('o7').probability >= first.risk.get('o7').probability);
});

test('a project whose throughput cannot finish within a year is reported as stalled', () => {
  const history = [doneOn(-1), doneOn(-2), doneOn(-3)];
  const tasks = [...history, ...Array.from({ length: 400 }, (_, i) => open(`o${i}`, null))];
  const result = forecastProject(tasks, { today: TODAY, simulations: 200 });
  assert.equal(result.state, 'stalled');
  assert.equal(result.finish.p50, null);
});

test('risk levels and the PRNG', () => {
  assert.equal(riskLevel(0.9), 'on-track');
  assert.equal(riskLevel(0.85), 'on-track');
  assert.equal(riskLevel(0.6), 'tight');
  assert.equal(riskLevel(0.49), 'at-risk');
  const a = seededRandom(1);
  const b = seededRandom(1);
  const values = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(values.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(values.every((value) => value >= 0 && value < 1));
});

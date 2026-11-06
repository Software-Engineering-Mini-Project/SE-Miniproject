import { describe, expect, it } from 'vitest';
import { completionPercent, dueBuckets, priorityCounts, UNASSIGNED_ID, workloadByMember } from '../../src/lib/insights.js';

const task = (id, status, dueDate, assigneeIds = [], priority = 'Medium') => ({ id, status, dueDate, assigneeIds, priority });
const today = '2026-12-30';
const tasks = [
  task('a', 'To Do', '2026-12-29', ['u1']),
  task('b', 'In Progress', '2026-12-30', ['u1', 'u2'], 'High'),
  task('c', 'To Do', '2027-01-06', ['u2'], 'High'), // today + 7, across a year boundary
  task('d', 'To Do', '2027-01-07', [], 'Low'),
  task('e', 'To Do', null, ['u1']),
  task('f', 'Done', '2026-12-01', ['u2']), // done work is never overdue
];

describe('dueBuckets', () => {
  it('sorts open work into calendar buckets and skips Done', () => {
    expect(dueBuckets(tasks, today).map((b) => [b.key, b.count])).toEqual([
      ['overdue', 1], ['today', 1], ['week', 1], ['later', 1], ['none', 1],
    ]);
  });
});

describe('priorityCounts', () => {
  it('counts only open tasks, High first', () => {
    expect(priorityCounts(tasks).map((p) => [p.key, p.count])).toEqual([['High', 2], ['Medium', 2], ['Low', 1]]);
  });
});

describe('workloadByMember', () => {
  const members = [{ id: 'u1', name: 'Bo' }, { id: 'u2', name: 'Al' }, { id: 'u3', name: 'Cy' }];

  it('splits each member by status, busiest first, with unassigned last', () => {
    const rows = workloadByMember(tasks, members, today);
    expect(rows.map((r) => r.id)).toEqual(['u1', 'u2', 'u3', UNASSIGNED_ID]);
    expect(rows[0]).toMatchObject({ total: 3, overdue: 1, counts: { 'To Do': 2, 'In Progress': 1, Done: 0 } });
    expect(rows[1]).toMatchObject({ total: 3, overdue: 0, counts: { 'To Do': 1, 'In Progress': 1, Done: 1 } });
    expect(rows[2]).toMatchObject({ total: 0 });
    expect(rows[3]).toMatchObject({ name: 'Unassigned', total: 1 });
  });

  it('ignores assignees who are no longer members and omits an empty unassigned row', () => {
    const rows = workloadByMember([task('x', 'To Do', null, ['gone'])], members, today);
    expect(rows.every((r) => r.total === 0)).toBe(true);
    expect(rows.some((r) => r.id === UNASSIGNED_ID)).toBe(false);
  });
});

describe('completionPercent', () => {
  it('rounds the share of Done tasks', () => {
    expect(completionPercent(tasks)).toBe(17);
    expect(completionPercent([])).toBe(0);
  });
});

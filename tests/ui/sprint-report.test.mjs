// The sprint report (issue #77): stats from the report, a burndown read from the keyboard, a
// table equivalent, and velocity across completed sprints.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queries: new Map(), api: { sprints: { report: vi.fn() } } }));
vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('@/lib/hooks/useQuery', () => ({
  useQuery: (key) => state.queries.get(key) ?? { data: undefined, error: null, loading: true, reload: vi.fn(), setData: vi.fn() },
}));

const { SprintReport } = await import('../../src/features/sprints/SprintReport.jsx');
const h = React.createElement;

const report = (part) => ({ taskIds: [], count: 0, points: 0, ...part });
const sprints = [
  { id: 's1', number: 1, name: 'ALPHA Sprint 1', state: 'completed', startDate: '2026-10-04', endDate: '2026-10-13', completedAt: '2026-10-13T17:00:00Z', committed: { taskIds: ['a', 'b', 'c'], points: 4 }, report: { completed: report({ taskIds: ['a', 'b'], count: 2, points: 2 }), unfinished: report({ taskIds: ['c'], count: 1, points: 2 }), movedTo: 's2' } },
  { id: 's2', number: 2, name: 'ALPHA Sprint 2', state: 'active', startDate: '2026-10-14', endDate: '2026-10-17', startedAt: '2026-10-14T09:00:00Z', committed: { taskIds: ['c', 'd'], points: 8 } },
];
state.queries.set('sprints:report:s2', {
  data: {
    sprintId: 's2', unit: 'points',
    days: [
      { date: '2026-10-14', remaining: 8, ideal: 8 }, { date: '2026-10-15', remaining: 5, ideal: 5.3 },
      { date: '2026-10-16', remaining: 7, ideal: 2.7 }, { date: '2026-10-17', remaining: null, ideal: 0 },
    ],
    committed: report({ taskIds: ['c', 'd'], count: 2, points: 8 }), added: report({ taskIds: ['e'], count: 1, points: 2 }),
    removed: report(), completed: report({ taskIds: ['d'], count: 1, points: 3 }), carriedOver: { ...report(), movedTo: null },
  },
  error: null, loading: false, reload: vi.fn(), setData: vi.fn(),
});

describe('the sprint report', () => {
  it('shows committed, completed and added work, and reads the burndown day by day from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    render(h(SprintReport, { sprints, tasks: [{ id: 'e', key: 'ALPHA-9', title: 'Late addition' }], onOpenTask }));
    const stats = screen.getByRole('region', { name: 'Sprint report' }).querySelector('.sprint-stats');
    expect(stats).toHaveTextContent('Committed8 points2 items');
    expect(stats).toHaveTextContent('Completed3 points1 item');
    expect(stats).toHaveTextContent('Added during the sprint1 item');
    expect(stats).toHaveTextContent('Days left1');

    const plot = screen.getByRole('group', { name: /Burndown in points/ });
    expect(screen.getByText('16 Oct: 7 points remaining, ideal 2.7')).toBeInTheDocument();
    plot.focus();
    await user.keyboard('{Home}');
    expect(screen.getByText('14 Oct: 8 points remaining, ideal 8')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('15 Oct: 5 points remaining, ideal 5.3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ALPHA-9' }));
    expect(onOpenTask).toHaveBeenCalledWith('e');
  });

  it('has a table equivalent of the burndown and of velocity', async () => {
    const user = userEvent.setup();
    render(h(SprintReport, { sprints, tasks: [] }));
    await user.click(within(screen.getByRole('group', { name: 'Show the burndown as' })).getByRole('button', { name: 'Table' }));
    const rows = within(screen.getByRole('table', { name: 'Burndown by day' })).getAllByRole('row').map((row) => row.textContent);
    expect(rows).toEqual(['DayRemaining (points)Ideal', '14 Oct88', '15 Oct55.3', '16 Oct72.7', '17 Oct—0']);

    expect(screen.getByText(/2 on average over the last 1 sprint/)).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'ALPHA Sprint 1: 2 of 4 points committed completed' })).toHaveAttribute('tabindex', '0');
    await user.click(within(screen.getByRole('group', { name: 'Show velocity as' })).getByRole('button', { name: 'Table' }));
    expect(within(screen.getByRole('table', { name: /Velocity/ })).getAllByRole('row').map((row) => row.textContent)).toEqual(['SprintCommittedCompleted', 'ALPHA Sprint 142']);
  });

  it('shows nothing until a sprint has started', () => {
    const { container } = render(h(SprintReport, { sprints: [{ ...sprints[1], state: 'planned' }] }));
    expect(container).toBeEmptyDOMElement();
  });
});

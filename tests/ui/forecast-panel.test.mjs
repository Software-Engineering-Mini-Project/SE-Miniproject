// Delivery forecast UI: the Insights panel and the task risk flag.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ForecastPanel } from '../../src/features/projects/ForecastPanel.jsx';
import { RiskTag } from '../../src/components/ui/Tags.jsx';
import { forecastProject } from '../../src/lib/forecast.js';
import { localToday } from '../../src/lib/dates.js';

const h = React.createElement;
const today = localToday();
const DAY = 86_400_000;
const dayOffset = (n) => localToday(new Date(Date.now() + n * DAY));
// Local noon, so the completion lands on the intended calendar day in any time zone.
const doneOn = (n, id) => {
  const [y, m, d] = dayOffset(n).split('-').map(Number);
  return { id, title: id, status: 'Done', priority: 'Medium', dueDate: null, completedAt: new Date(y, m - 1, d, 12).toISOString() };
};
const open = (id, dueIn, extra = {}) => ({ id, title: `Task ${id}`, status: 'To Do', priority: 'Medium', dueDate: dueIn === null ? null : dayOffset(dueIn), createdAt: '2026-01-01T00:00:00Z', ...extra });

function renderPanel(tasks, onOpenTask = vi.fn()) {
  const forecast = forecastProject(tasks, { today, simulations: 500 });
  render(h(ForecastPanel, { forecast, tasks, onOpenTask }));
  return { forecast, onOpenTask };
}

describe('ForecastPanel', () => {
  it('shows the 85% finish date, weekly throughput and the due dates it doubts', async () => {
    const user = userEvent.setup();
    // One completion a day for six weeks, so open tasks finish one a day, in queue order, in
    // every run: the overdue task on day 0, "late" (due today) on day 1, "soon" (due tomorrow)
    // on day 2, and the rest well before their due dates.
    const history = Array.from({ length: 42 }, (_, i) => doneOn(-i, `h${i}`));
    const tasks = [...history, open('overdue', -2), open('late', 0), open('soon', 1), open('fine', 30), open('later', 31, { title: 'Write the handbook' })];
    const { forecast, onOpenTask } = renderPanel(tasks);
    expect(forecast.state).toBe('ready');

    const panel = screen.getByRole('region', { name: /delivery forecast/i });
    expect(within(panel).getByText('85% likely to be done by')).toBeInTheDocument();
    expect(within(panel).getByText(/Based on 42 tasks completed in the last 6 weeks \(7 a week\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/5 open tasks/)).toBeInTheDocument();

    const weeks = within(panel).getByRole('list', { name: 'Tasks completed per week, last 6 weeks' });
    expect(within(weeks).getAllByRole('listitem')).toHaveLength(6);
    expect(within(weeks).getAllByText('7')).toHaveLength(6);

    // Overdue tasks are not forecast (they are already marked overdue); on-track tasks are not listed.
    const risky = within(panel).getAllByRole('button', { name: /chance/ });
    expect(risky.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Task late'),
      expect.stringContaining('Task soon'),
    ]);
    expect(risky[0]).toHaveTextContent('0% chance');
    expect(within(panel).queryByText('Task overdue')).not.toBeInTheDocument();
    expect(within(risky[0]).getByText('At risk')).toBeInTheDocument();
    await user.click(risky[1]);
    expect(onOpenTask).toHaveBeenCalledWith('soon');
    expect(within(panel).queryByText('Write the handbook')).not.toBeInTheDocument();
  });

  it('says what it needs when there is too little history, and hides itself for an empty project', () => {
    renderPanel([open('a', 3), doneOn(-1, 'd1')]);
    expect(screen.getByText(/needs at least 3 tasks completed in the last 6 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/So far:\s*1\./)).toBeInTheDocument();
    expect(screen.queryByText('Due dates the forecast doubts')).not.toBeInTheDocument();

    const { container } = render(h(ForecastPanel, { forecast: forecastProject([], { today }), tasks: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a finished project and a project too slow to forecast', () => {
    renderPanel([doneOn(-1, 'a'), doneOn(-2, 'b')]);
    expect(screen.getByText('Every task in this project is done.')).toBeInTheDocument();

    // Three completions in six weeks cannot clear 400 tasks within a year.
    renderPanel([doneOn(-1, 'c'), doneOn(-2, 'd'), doneOn(-3, 'e'), ...Array.from({ length: 400 }, (_, i) => open(`o${i}`, null))]);
    expect(screen.getByText(/would take more than a year/)).toBeInTheDocument();
  });

  it('confirms when every dated task is on track', () => {
    const history = Array.from({ length: 42 }, (_, i) => doneOn(-i, `h${i}`));
    renderPanel([...history, open('fine', 30), open('undated', null)]);
    expect(screen.getByText('Every dated open task is on track (85% or better).')).toBeInTheDocument();
  });
});

describe('RiskTag', () => {
  it('renders only for tight and at-risk tasks, with the chance as text', () => {
    const { container, rerender } = render(h(RiskTag, { risk: { probability: 0.9, level: 'on-track' } }));
    expect(container).toBeEmptyDOMElement();
    rerender(h(RiskTag, { risk: { probability: 0.62, level: 'tight' } }));
    expect(screen.getByText('Tight')).toBeInTheDocument();
    expect(screen.getByText(/62% chance of finishing by the due date/)).toBeInTheDocument();
    rerender(h(RiskTag, { risk: { probability: 0.1, level: 'at-risk' } }));
    expect(screen.getByText('At risk').closest('.risk-tag')).toHaveAttribute('data-level', 'at-risk');
    rerender(h(RiskTag, { risk: undefined }));
    expect(container).toBeEmptyDOMElement();
  });
});

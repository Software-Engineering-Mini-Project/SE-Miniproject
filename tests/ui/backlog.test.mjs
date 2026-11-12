// The Backlog view (issue #76): sprints above the ranked backlog, planning from each row's menu,
// sprint controls only for Owners and Managers, and completing a sprint.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  api: { sprints: { complete: vi.fn(), start: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}));

vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Menus render their items as plain buttons, so the test can press them.
vi.mock('@/components/ui/Menu', async () => {
  const { createElement } = await import('react');
  return {
    Menu: ({ trigger, items }) => createElement(
      'div',
      { role: 'group', 'aria-label': trigger.props['aria-label'] },
      items.filter((item) => item && !item.separator).map((item) => createElement('button', { key: item.label, type: 'button', disabled: item.disabled, onClick: item.onSelect }, item.label)),
    ),
  };
});
vi.mock('@/components/ui/Dialog', async () => {
  const { createElement } = await import('react');
  return { Modal: ({ open, title, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': title }, children) : null) };
});

const { BacklogView } = await import('../../src/features/sprints/BacklogView.jsx');
const h = React.createElement;

const members = [{ id: 'u1', name: 'Mina Member' }];
const task = (id, extra) => ({ id, key: `ALPHA-${id.slice(1)}`, title: `Task ${id}`, status: 'To Do', type: 'Task', storyPoints: null, labels: [], assigneeIds: [], sprintId: null, ...extra });
const tasks = [
  task('t1', { sprintId: 's2', rank: 1024, storyPoints: 5, status: 'In Progress' }),
  task('t2', { sprintId: 's2', rank: 2048, storyPoints: 3 }),
  task('t3', { rank: 3072 }),
  task('t4', { rank: 4096, storyPoints: 2 }),
  task('t5', { rank: 5120, status: 'Done' }),
  task('t6', { sprintId: 's1', rank: 6144, status: 'Done' }),
];
const sprints = [
  { id: 's1', number: 1, name: 'ALPHA Sprint 1', state: 'completed', startDate: '2026-10-04', endDate: '2026-10-13', completedAt: '2026-10-13T17:00:00Z', goal: '', report: { completed: { taskIds: ['t6'], count: 1, points: 0 }, unfinished: { taskIds: ['t2'], count: 1, points: 3 }, movedTo: 's2' } },
  { id: 's2', number: 2, name: 'ALPHA Sprint 2', state: 'active', startDate: '2026-10-14', endDate: '2026-10-27', goal: 'Sign-in works end to end' },
  { id: 's3', number: 3, name: 'ALPHA Sprint 3', state: 'planned', startDate: '2026-10-28', endDate: '2026-11-10', goal: '' },
];
const project = { id: 'p1', key: 'ALPHA', name: 'Alpha' };

function renderBacklog(props = {}) {
  const onPlan = vi.fn();
  const onSprintsChange = vi.fn();
  render(h(BacklogView, { project, tasks, allTasks: tasks, sprints, members, today: '2026-10-20', canPlan: true, canManage: true, onPlan, onOpen: vi.fn(), onSprintsChange, ...props }));
  return { onPlan, onSprintsChange };
}

const section = (name) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const rows = (name) => within(within(section(name)).getByRole('list')).getAllByRole('listitem').map((item) => item.querySelector('.backlog-title')?.textContent ?? item.textContent);

describe('the Backlog view', () => {
  it('shows the active sprint, planned sprints, the ranked backlog and the completed sprints', () => {
    renderBacklog();
    const active = section('ALPHA Sprint 2');
    expect(within(active).getByText('Active')).toBeInTheDocument();
    expect(within(active).getByText(/14 Oct – 27 Oct 2026 · 7 days left · 2 items · 8 points · 0 done/)).toBeInTheDocument();
    expect(within(active).getByText('Sign-in works end to end')).toBeInTheDocument();
    expect(rows('ALPHA Sprint 2')).toEqual(['Task t1', 'Task t2']);
    expect(rows('ALPHA Sprint 3')).toEqual([expect.stringMatching(/Drag tasks here/)]);
    // Finished work outside sprints is hidden from the backlog and counted.
    expect(rows('Backlog')).toEqual(['Task t3', 'Task t4']);
    expect(within(section('Backlog')).getByText(/1 finished task not in a sprint hidden/)).toBeInTheDocument();
    const record = screen.getByText('ALPHA Sprint 1').closest('details');
    expect(record).toHaveTextContent('Finished 1 of 2 items');
    expect(record).toHaveTextContent('1 unfinished item moved to ALPHA Sprint 2.');
  });

  it('plans a task from its menu: into a sprint at its bottom, or to the top of its list', async () => {
    const user = userEvent.setup();
    const { onPlan } = renderBacklog();
    const menu = screen.getByRole('group', { name: 'Plan ALPHA-4' });
    await user.click(within(menu).getByRole('button', { name: 'Move to ALPHA Sprint 2' }));
    expect(onPlan).toHaveBeenLastCalledWith('t4', { previousId: 't2', nextId: null, sprintId: 's2' });
    await user.click(within(menu).getByRole('button', { name: 'Move to top' }));
    expect(onPlan).toHaveBeenLastCalledWith('t4', { previousId: null, nextId: 't3' });
    await user.click(within(screen.getByRole('group', { name: 'Plan ALPHA-1' })).getByRole('button', { name: 'Move to the backlog' }));
    expect(onPlan).toHaveBeenLastCalledWith('t1', { previousId: null, nextId: 't3', sprintId: null });
    expect(screen.getByRole('button', { name: 'Reorder ALPHA-4' })).toHaveAttribute('aria-describedby', 'backlog-dnd-help');
  });

  it('gives sprint controls only to Owners and Managers, and planning only to people who can edit', () => {
    renderBacklog({ canManage: false });
    expect(screen.queryByRole('button', { name: /Create sprint/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete sprint/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Plan ALPHA-3' })).toBeInTheDocument();
  });

  it('a Viewer sees the plan but cannot drag or move anything', () => {
    renderBacklog({ canManage: false, canPlan: false });
    expect(screen.queryByRole('button', { name: /^Reorder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^Plan/ })).not.toBeInTheDocument();
  });

  it('completes the active sprint, sending unfinished work where the person chose', async () => {
    const user = userEvent.setup();
    state.api.sprints.complete.mockResolvedValue({ ...sprints[1], state: 'completed', report: { completed: { taskIds: [], count: 0, points: 0 }, unfinished: { taskIds: ['t1', 't2'], count: 2, points: 8 }, movedTo: 's3' } });
    const { onSprintsChange } = renderBacklog();
    await user.click(within(section('ALPHA Sprint 2')).getByRole('button', { name: /Complete sprint/ }));
    const dialog = screen.getByRole('dialog', { name: 'Complete ALPHA Sprint 2?' });
    expect(dialog).toHaveTextContent('0 items of 2 finished, 0 of 8 points.');
    await user.click(within(dialog).getByRole('radio', { name: 'ALPHA Sprint 3' }));
    await user.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    expect(state.api.sprints.complete).toHaveBeenCalledWith('s2', 's3');
    expect(onSprintsChange).toHaveBeenCalled();
  });
});

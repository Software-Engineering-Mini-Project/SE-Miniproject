// The task sheet's Activity tab (issue #75): readable sentences, newest first, keyboard tabs.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queries: new Map(),
  api: { tasks: { activity: vi.fn(), update: vi.fn(), remove: vi.fn() }, comments: { list: vi.fn() }, checklist: {} },
}));

vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/session', () => ({ useSession: (selector) => (selector ? selector({ user: { id: 'u1' } }) : { user: { id: 'u1' } }) }));
vi.mock('@/lib/hooks/useQuery', () => ({
  useQuery: (key) => state.queries.get(key) ?? { data: undefined, error: null, loading: true, reload: vi.fn(), setData: vi.fn() },
}));
vi.mock('@/components/ui/Dialog', async () => {
  const { cloneElement, createElement } = await import('react');
  return {
    Modal: ({ open, title, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': title }, children) : null),
    Sheet: ({ open, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': 'Task details' }, children) : null),
    SheetTitle: ({ children, ...props }) => createElement('h2', props, children),
    SheetClose: ({ render: element, children }) => cloneElement(element, {}, children),
  };
});

const { TaskSheet } = await import('../../src/features/tasks/TaskSheet.jsx');
const h = React.createElement;

const members = [{ id: 'u1', name: 'Mina Member' }, { id: 'u2', name: 'Lena Lead' }];
const task = {
  id: 't1', key: 'ALPHA-12', title: 'Fix login', description: '', status: 'In Progress', priority: 'High', dueDate: null,
  assigneeIds: [], checklist: [], projectId: 'p1', type: 'Task', storyPoints: null, labels: [], epicId: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

describe('the Activity tab', () => {
  it('lists changes as sentences, newest first, and switches tabs from the keyboard', async () => {
    const user = userEvent.setup();
    state.queries.set('comments:t1', { data: [], error: null, loading: false, reload: vi.fn(), setData: vi.fn() });
    state.queries.set('activity:t1', {
      data: {
        items: [
          { id: 'a2', action: 'status', details: { from: 'To Do', to: 'In Progress' }, actor: { id: 'u1', name: 'Mina Member' }, createdAt: minutesAgo(5) },
          { id: 'a1', action: 'assignees', details: { added: ['u1'], removed: [] }, actor: { id: 'u2', name: 'Lena Lead' }, createdAt: minutesAgo(90) },
          { id: 'a0', action: 'created', details: {}, actor: null, createdAt: minutesAgo(120) },
        ],
        page: 1, pageSize: 50, total: 3,
      },
      error: null, loading: false, reload: vi.fn(), setData: vi.fn(),
    });
    render(h(TaskSheet, { task, members, open: true, onOpenChange: vi.fn() }));

    const comments = screen.getByRole('tab', { name: 'Comments' });
    expect(comments).toHaveAttribute('aria-selected', 'true');
    comments.focus();
    await user.keyboard('{ArrowRight}');
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(activity).toHaveAttribute('aria-selected', 'true');
    expect(activity).toHaveFocus();

    const list = within(screen.getByRole('tabpanel', { name: 'Activity' })).getByRole('list', { name: 'Activity, newest first' });
    const entries = within(list).getAllByRole('listitem').map((item) => item.querySelector('.activity-text').textContent);
    expect(entries[0]).toMatch(/^Mina Member moved ALPHA-12 from To Do to In Progress · 5 min ago$/);
    expect(entries[1]).toMatch(/^Lena Lead assigned Mina Member to ALPHA-12 · /);
    expect(entries[2]).toMatch(/^Someone created ALPHA-12 · /);
    expect(within(list).getAllByRole('time')[0]).toHaveAttribute('dateTime');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says so when a task has no history', async () => {
    const user = userEvent.setup();
    state.queries.set('activity:t1', { data: { items: [], page: 1, pageSize: 50, total: 0 }, error: null, loading: false, reload: vi.fn(), setData: vi.fn() });
    render(h(TaskSheet, { task, members, open: true, onOpenChange: vi.fn() }));
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('Nothing has happened to this task yet.')).toBeInTheDocument();
  });
});

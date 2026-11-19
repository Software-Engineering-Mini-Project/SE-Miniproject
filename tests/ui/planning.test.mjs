// Quick add, task checklists and the Upcoming agenda.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../../src/lib/dates.js';

const state = vi.hoisted(() => ({
  api: {
    tasks: { create: vi.fn(), search: vi.fn() },
    checklist: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
  toast: { success: vi.fn(), error: vi.fn() },
  router: { push: vi.fn(), replace: vi.fn() },
  session: {},
  workspace: {},
  search: null,
}));

vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/lib/session', () => ({ useSession: (selector) => (selector ? selector(state.session) : state.session) }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: (selector) => (selector ? selector(state.workspace) : state.workspace) }));
vi.mock('@/lib/hooks/useQuery', () => ({
  useQuery: (key) => (key?.startsWith('search:') ? state.search : { data: undefined, error: null, reload: vi.fn() }),
}));

const { QuickAdd } = await import('../../src/features/tasks/QuickAdd.jsx');
const { Checklist } = await import('../../src/features/tasks/Checklist.jsx');
const { TaskCard } = await import('../../src/features/board/TaskCard.jsx');
const { MyTasks } = await import('../../src/features/tasks/MyTasks.jsx');

const h = React.createElement;
const today = localToday();
const plusDays = (n) => localToday(new Date(Date.now() + n * 86_400_000));
const members = [
  { id: 'mina', name: 'Mina Member', email: 'member@example.test' },
  { id: 'lead', name: 'Synthetic Lead', email: 'lead@example.test' },
];
const items = [
  { id: 'c1', text: 'Lay out the columns', done: true },
  { id: 'c2', text: 'Drag between columns', done: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('QuickAdd', () => {
  it('previews what it understood, lets a word stay text, and creates the task on Enter', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    state.api.tasks.create.mockResolvedValue({ id: 't9', title: 'Draft notes tomorrow', assigneeIds: ['mina'] });
    render(h(QuickAdd, { projectId: 'p1', members, currentUserId: 'lead', onCreated }));

    const input = screen.getByRole('textbox', { name: 'Quick add a task' });
    await user.type(input, 'Draft notes tomorrow !high @mina @ghost');
    expect(screen.getByText('High priority')).toBeInTheDocument();
    expect(screen.getByText('Due tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Mina Member')).toBeInTheDocument();
    expect(screen.getByText('No assignable member matches @ghost')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep "tomorrow" as text' }));
    expect(screen.queryByText('Due tomorrow')).not.toBeInTheDocument();

    await user.type(input, '{Enter}');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(state.api.tasks.create).toHaveBeenCalledWith('p1', {
      title: 'Draft notes tomorrow @ghost',
      status: 'To Do',
      priority: 'High',
      dueDate: null,
      assigneeIds: ['mina'],
    });
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('asks for a title when the line has only details, and shows API errors', async () => {
    const user = userEvent.setup();
    render(h(QuickAdd, { projectId: 'p1', members, currentUserId: 'lead', onCreated: vi.fn() }));
    const input = screen.getByRole('textbox', { name: 'Quick add a task' });
    await user.type(input, 'tomorrow !high{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Add a title as well as the details.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(state.api.tasks.create).not.toHaveBeenCalled();

    state.api.tasks.create.mockRejectedValue(new Error('Network down'));
    await user.clear(input);
    await user.type(input, 'Real task{Enter}');
    await waitFor(() => expect(state.toast.error).toHaveBeenCalled());
    expect(input).toHaveValue('Real task');

    await user.clear(input);
    await user.type(input, 'Throwaway{Escape}');
    expect(input).toHaveValue('');
  });
});

describe('Checklist', () => {
  const task = { id: 't1', checklist: items };

  it('lets members tick items, optimistically, without editing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    state.api.checklist.update.mockResolvedValue({ checklist: items.map((item) => ({ ...item, done: true })), updatedAt: 'later' });
    render(h(Checklist, { task, canTick: true, canEdit: false, onChange }));

    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a checklist item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Drag between columns' }));
    expect(onChange).toHaveBeenNthCalledWith(1, [items[0], { ...items[1], done: true }]);
    expect(state.api.checklist.update).toHaveBeenCalledWith('t1', 'c2', { done: true });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.any(Array), 'later'));
  });

  it('rolls a tick back when the API refuses it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    state.api.checklist.update.mockRejectedValue(new Error('Forbidden'));
    render(h(Checklist, { task, canTick: true, canEdit: false, onChange }));
    await user.click(screen.getByRole('checkbox', { name: 'Lay out the columns' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(items));
    expect(state.toast.error).toHaveBeenCalled();
  });

  it('is read-only for viewers and hidden when there is nothing to show', () => {
    const { rerender, container } = render(h(Checklist, { task, canTick: false, canEdit: false, onChange: vi.fn() }));
    expect(screen.getByRole('checkbox', { name: 'Lay out the columns' })).toBeDisabled();
    rerender(h(Checklist, { task: { id: 't2', checklist: [] }, canTick: false, canEdit: false, onChange: vi.fn() }));
    expect(container).toBeEmptyDOMElement();
    rerender(h(Checklist, { task: { id: 't3' }, canTick: true, canEdit: true, onChange: vi.fn() }));
    expect(screen.getByRole('textbox', { name: 'Add a checklist item' })).toBeInTheDocument();
  });

  it('lets owners add items one after another and remove them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    state.api.checklist.add.mockResolvedValue({ checklist: [...items, { id: 'c3', text: 'Empty state', done: false }], updatedAt: 'x' });
    state.api.checklist.remove.mockResolvedValue({ checklist: [items[1]], updatedAt: 'y' });
    render(h(Checklist, { task, canTick: true, canEdit: true, onChange }));

    const field = screen.getByRole('textbox', { name: 'Add a checklist item' });
    await user.type(field, '  Empty state {Enter}');
    expect(state.api.checklist.add).toHaveBeenCalledWith('t1', 'Empty state');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(field).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove "Lay out the columns"' }));
    expect(onChange).toHaveBeenCalledWith([items[1]]);
    expect(state.api.checklist.remove).toHaveBeenCalledWith('t1', 'c1');
  });
});

it('board cards show checklist progress', () => {
  render(h(TaskCard, { task: { id: 't1', title: 'Board', status: 'To Do', priority: 'Low', dueDate: null, assigneeIds: [], checklist: items } }));
  const card = screen.getByRole('article');
  expect(within(card).getByText('1/2')).toBeInTheDocument();
  expect(within(card).getByText('checklist items done')).toBeInTheDocument();
});

describe('My tasks: Upcoming', () => {
  it('groups open tasks into an agenda and remembers the choice', async () => {
    const user = userEvent.setup();
    state.session = { user: { id: 'mina', name: 'Mina Member' } };
    state.workspace = { projects: [{ id: 'p1', name: 'Alpha', members }] };
    const task = (id, title, dueDate, extra = {}) => ({ id, title, status: 'To Do', priority: 'Medium', dueDate, projectId: 'p1', assigneeIds: ['mina'], ...extra });
    state.search = {
      data: [
        task('a', 'Fix the overdue bug', plusDays(-2)),
        task('b', 'Write today notes', today),
        task('c', 'Plan tomorrow', plusDays(1)),
        task('d', 'Someday', null),
        task('e', 'Already done', today, { status: 'Done' }),
      ],
      error: null,
      reload: vi.fn(),
    };
    render(h(MyTasks));
    expect(screen.queryByRole('heading', { name: /^Overdue/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upcoming' }));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(expect.arrayContaining(['Overdue1', 'Today1', 'Tomorrow1', 'No due date1']));
    expect(screen.queryByText('Already done')).not.toBeInTheDocument();
    expect(screen.getByText('1 done task not shown.')).toBeInTheDocument();
    const overdue = screen.getByRole('region', { name: /^Overdue/ });
    expect(within(overdue).getByText('Fix the overdue bug')).toBeInTheDocument();
    expect(window.localStorage.getItem('taskline.myTasksView')).toBe('upcoming');

    await user.click(within(overdue).getByRole('button', { name: /Fix the overdue bug/ }));
    expect(state.router.push).toHaveBeenCalledWith('/projects/p1?task=a');
  });
});

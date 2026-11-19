// Work-item types, story points, labels and epics in the UI (issue #74): the form, cards, the
// task sheet, the filters and quick add.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  api: {
    tasks: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    checklist: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
    comments: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('@/lib/session', () => ({ useSession: (selector) => (selector ? selector({ user: { id: 'me' } }) : { user: { id: 'me' } }) }));
vi.mock('@/lib/hooks/useQuery', () => ({ useQuery: () => ({ data: [], error: null, reload: vi.fn(), setData: vi.fn() }) }));
vi.mock('@/components/ui/Dialog', async () => {
  const { cloneElement, createElement } = await import('react');
  return {
    Modal: ({ open, title, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': title }, children) : null),
    Sheet: ({ open, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': 'Task details' }, children) : null),
    SheetTitle: ({ children, ...props }) => createElement('h2', props, children),
    SheetClose: ({ render: element, children }) => cloneElement(element, {}, children),
  };
});

const { TaskForm } = await import('../../src/features/tasks/TaskForm.jsx');
const { TaskCard } = await import('../../src/features/board/TaskCard.jsx');
const { TaskSheet } = await import('../../src/features/tasks/TaskSheet.jsx');
const { TaskFilters, applyFilters, EMPTY_FILTERS } = await import('../../src/features/tasks/TaskFilters.jsx');
const { QuickAdd } = await import('../../src/features/tasks/QuickAdd.jsx');
const { WorkItemContext, buildWorkItemIndex } = await import('../../src/features/tasks/work-item-context.js');

const h = React.createElement;
const base = { description: '', priority: 'Medium', dueDate: null, assigneeIds: [], checklist: [], projectId: 'p1', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
const epic = { ...base, id: 'e1', key: 'ALPHA-1', number: 1, title: 'Board epic', status: 'In Progress', type: 'Epic', storyPoints: null, labels: ['frontend'], epicId: null };
const story = { ...base, id: 's1', key: 'ALPHA-2', number: 2, title: 'Drag cards', status: 'Done', type: 'Story', storyPoints: 3, labels: ['frontend', 'a11y'], epicId: 'e1' };
const bug = { ...base, id: 'b1', key: 'ALPHA-3', number: 3, title: 'Card jumps', status: 'To Do', type: 'Bug', storyPoints: 5, labels: ['frontend', 'ui', 'urgent', 'extra'], epicId: 'e1' };
const plain = { ...base, id: 't1', key: 'ALPHA-4', number: 4, title: 'Write docs', status: 'To Do', type: 'Task', storyPoints: null, labels: [], epicId: null };
const tasks = [epic, story, bug, plain];
const withItems = (element) => h(WorkItemContext, { value: buildWorkItemIndex(tasks) }, element);

beforeEach(() => vi.clearAllMocks());

describe('the task form', () => {
  it('sets type, points, epic and labels, and never offers an epic inside an epic', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(withItems(h(TaskForm, { members: [], submitLabel: 'Create task', onSubmit })));

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Fix the drop zone');
    await user.selectOptions(screen.getByLabelText('Type'), 'Bug');
    await user.selectOptions(screen.getByLabelText('Story points'), '8');
    await user.selectOptions(screen.getByLabelText('Epic'), 'e1');
    const labels = screen.getByRole('combobox', { name: 'Labels' });
    await user.type(labels, 'Front End{Enter}ui,urgent{Enter}');
    await user.click(screen.getByRole('button', { name: 'Remove label ui' }));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Fix the drop zone', type: 'Bug', storyPoints: 8, epicId: 'e1', labels: ['front-end', 'urgent'],
    })));

    await user.selectOptions(screen.getByLabelText('Type'), 'Epic');
    expect(screen.getByLabelText('Epic')).toBeDisabled();
    expect(screen.getByText('An epic cannot belong to another epic.')).toBeInTheDocument();
  });

  it('refuses a label that is too long, and lists only real epics other than the task itself', async () => {
    const user = userEvent.setup();
    render(withItems(h(TaskForm, { initial: epic, members: [], onSubmit: vi.fn() })));
    await user.selectOptions(screen.getByLabelText('Type'), 'Story');
    expect(within(screen.getByLabelText('Epic')).queryByRole('option', { name: /Board epic/ })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Labels' }), `${'x'.repeat(31)}{Enter}`);
    expect(screen.getByText('Keep labels to 30 characters or fewer.')).toBeInTheDocument();
  });
});

describe('cards and the task sheet', () => {
  it('a card shows its type, points, labels and epic; an epic card shows its progress', () => {
    const { container } = render(withItems(h('div', null, h(TaskCard, { task: bug }), h(TaskCard, { task: epic }))));
    const [bugCard, epicCard] = container.querySelectorAll('.task-card');
    expect(within(bugCard).getByText('Bug')).toBeInTheDocument();
    expect(within(bugCard).getByText('5 story points')).toBeInTheDocument();
    expect(within(bugCard).getByText('frontend')).toBeInTheDocument();
    expect(within(bugCard).getByText('+1')).toBeInTheDocument();
    expect(within(bugCard).getByText('Board epic')).toBeInTheDocument();
    const bar = within(epicCard).getByRole('progressbar', { name: 'Epic progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(within(epicCard).getByText('1/2 done')).toBeInTheDocument();
  });

  it('an epic lists its items and opens one; an item links back to its epic', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const { rerender } = render(withItems(h(TaskSheet, { task: epic, members: [], open: true, onOpenChange: vi.fn(), onOpenTask })));
    const list = screen.getByRole('region', { name: 'Items in this epic' });
    expect(within(list).getByText('1/2 done · 3/8 pts')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Card jumps/ }));
    expect(onOpenTask).toHaveBeenCalledWith('b1');

    rerender(withItems(h(TaskSheet, { task: story, members: [], open: true, onOpenChange: vi.fn(), onOpenTask })));
    expect(screen.getByText('Story')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Board epic/ }));
    expect(onOpenTask).toHaveBeenLastCalledWith('e1');
  });
});

describe('filters and quick add', () => {
  it('filters by type and label', async () => {
    const user = userEvent.setup();
    expect(applyFilters(tasks, { ...EMPTY_FILTERS, type: 'Bug' }).map((t) => t.id)).toEqual(['b1']);
    expect(applyFilters(tasks, { ...EMPTY_FILTERS, label: 'a11y' }).map((t) => t.id)).toEqual(['s1']);
    expect(applyFilters(tasks, { ...EMPTY_FILTERS, type: 'Task' }).map((t) => t.id)).toEqual(['t1']);
    const onChange = vi.fn();
    render(h(TaskFilters, { filters: EMPTY_FILTERS, onChange, labels: ['frontend', 'ui'] }));
    await user.selectOptions(screen.getByLabelText('Type'), 'Story');
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, type: 'Story' });
    await user.selectOptions(screen.getByLabelText('Label'), 'ui');
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, label: 'ui' });
  });

  it('quick add understands #bug, #labels and 3pts', async () => {
    const user = userEvent.setup();
    state.api.tasks.create.mockResolvedValue({ ...plain, id: 'new' });
    render(h(QuickAdd, { projectId: 'p1', members: [], currentUserId: 'me', onCreated: vi.fn() }));
    const input = screen.getByRole('textbox', { name: 'Quick add a task' });
    await user.type(input, 'Fix the redirect #bug #auth 3pts');
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('3 points')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(state.api.tasks.create).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Fix the redirect', type: 'Bug', labels: ['auth'], storyPoints: 3,
    })));
  });
});

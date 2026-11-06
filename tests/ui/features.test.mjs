import { localToday } from '../../src/lib/dates.js';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    router: { push: fn(), replace: fn() },
    searchParams: new Map(),
    queries: new Map(),
    session: {},
    workspace: {},
    api: {
      auth: { register: fn() },
      users: { updateMe: fn(), list: fn(), setRole: fn(), setActive: fn() },
      members: { add: fn(), remove: fn(), setRole: fn() },
      tasks: { search: fn(), get: fn(), create: fn(), update: fn(), remove: fn(), listByProject: fn(), setStatus: fn() },
      comments: { list: fn(), create: fn(), remove: fn() },
      notifications: { list: fn(), markRead: fn(), markAllRead: fn() },
      projects: { summary: fn(), get: fn(), create: fn(), update: fn(), remove: fn(), exportCsv: fn() },
      dashboard: { get: fn() },
    },
    toast: { success: fn(), error: fn(), info: fn() },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  useSearchParams: () => ({ get: (key) => state.searchParams.get(key) ?? null }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ href, children, ...props }) => createElement('a', { href, ...props }, children) };
});

vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('@/lib/session', () => ({ useSession: (selector) => (selector ? selector(state.session) : state.session) }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: (selector) => (selector ? selector(state.workspace) : state.workspace) }));
vi.mock('@/lib/hooks/useQuery', () => ({
  useQuery: (key) => state.queries.get(key) || { data: undefined, error: null, loading: Boolean(key), setData: vi.fn(), reload: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: state.toast }));

vi.mock('@/components/ui/Dialog', async () => {
  const { cloneElement, createElement } = await import('react');
  return {
    Modal: ({ open, title, children }) =>
      open ? createElement('section', { role: 'dialog', 'aria-label': title }, createElement('h2', null, title), children) : null,
    Sheet: ({ open, children }) => (open ? createElement('section', { role: 'dialog', 'aria-label': 'Task details' }, children) : null),
    SheetTitle: ({ children, ...props }) => createElement('h2', props, children),
    SheetClose: ({ render, children }) => cloneElement(render, {}, children),
  };
});

vi.mock('@number-flow/react', async () => {
  const { createElement } = await import('react');
  return { default: ({ value }) => createElement('span', null, value) };
});

vi.mock('@/components/ui/Menu', async () => {
  const { createElement, Fragment } = await import('react');
  return {
    Menu: ({ items }) => createElement(Fragment, null, items.filter((item) => item.label).map((item) => createElement('button', { key: item.label, type: 'button', onClick: item.onSelect }, item.label))),
  };
});

vi.mock('@dnd-kit/core', async () => {
  const { createElement, Fragment } = await import('react');
  return {
    DndContext: ({ children }) => createElement(Fragment, null, children),
    DragOverlay: ({ children }) => createElement(Fragment, null, children),
    KeyboardSensor: function KeyboardSensor() {},
    PointerSensor: function PointerSensor() {},
    TouchSensor: function TouchSensor() {},
    closestCorners: vi.fn(),
    useDraggable: ({ disabled }) => ({ attributes: { 'data-drag-disabled': String(Boolean(disabled)) }, listeners: {}, setNodeRef: vi.fn(), isDragging: false }),
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
    useSensor: () => ({}),
    useSensors: () => [],
  };
});

import { ApiError } from '@/lib/api/errors';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { LoginForm } from '@/features/auth/LoginForm';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { KanbanBoard } from '@/features/board/KanbanBoard';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { MembersDialog } from '@/features/projects/MembersDialog';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { ProjectsIndex } from '@/features/projects/ProjectsIndex';
import { ProjectView } from '@/features/projects/ProjectView';
import { CommentThread } from '@/features/tasks/CommentThread';
import { MyTasks } from '@/features/tasks/MyTasks';
import { TaskFilters, applyFilters } from '@/features/tasks/TaskFilters';
import { TaskForm } from '@/features/tasks/TaskForm';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskSheet } from '@/features/tasks/TaskSheet';
import { UsersAdmin } from '@/features/admin/UsersAdmin';
import { ProjectInsights } from '@/features/projects/ProjectInsights';

const h = React.createElement;

const member = { id: 'user-member-001', name: 'Mina Member', email: 'mina@example.test', role: 'Member' };
const lead = { id: 'user-lead-001', name: 'Lena Lead', email: 'lena@example.test', role: 'Lead' };
const project = { id: 'project-alpha', name: 'Alpha', ownerId: lead.id, memberIds: [lead.id, member.id], members: [lead, member] };
const task = {
  id: 'task-001',
  title: 'Review release',
  description: 'Check the release notes',
  status: 'To Do',
  priority: 'High',
  dueDate: '2026-11-01',
  projectId: project.id,
  assigneeIds: [member.id],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-02T12:00:00.000Z',
};

function setupQuery(key, data, extra = {}) {
  const result = { data, error: null, loading: false, setData: vi.fn(), reload: vi.fn(), ...extra };
  state.queries.set(key, result);
  return result;
}

function resetMockCalls(value) {
  for (const item of Object.values(value)) {
    if (vi.isMockFunction(item)) item.mockReset();
    else if (item && typeof item === 'object') resetMockCalls(item);
  }
}

beforeEach(() => {
  resetMockCalls(state.api);
  resetMockCalls(state.router);
  resetMockCalls(state.toast);
  state.queries.clear();
  state.searchParams = new Map();
  state.session = {
    user: { id: lead.id, name: lead.name, email: lead.email, role: lead.role, createdAt: '2026-01-01T00:00:00.000Z' },
    status: 'anonymous',
    reason: null,
    signIn: vi.fn().mockResolvedValue(lead),
    setUser: vi.fn(),
  };
  state.workspace = {
    projects: [project],
    setUnread: vi.fn(),
    loadProjects: vi.fn(),
    upsertProject: vi.fn(),
    removeProject: vi.fn(),
    loadUnread: vi.fn(),
    loadDashboard: vi.fn(),
  };
});

describe('authentication', () => {
  it('validates required login credentials before calling sign-in', async () => {
    const user = userEvent.setup();
    render(h(LoginForm));

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(state.session.signIn).not.toHaveBeenCalled();
  });

  it('signs in with trimmed email and follows a safe same-site return path', async () => {
    const user = userEvent.setup();
    state.searchParams.set('next', '/tasks');
    render(h(LoginForm));

    await user.type(screen.getByRole('textbox', { name: 'Email' }), '  lena@example.test  ');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(state.session.signIn).toHaveBeenCalledWith('lena@example.test', 'secret123'));
    expect(state.router.replace).toHaveBeenCalledWith('/tasks');
  });

  it('rejects an external redirect target and defaults to the dashboard', async () => {
    const user = userEvent.setup();
    state.searchParams.set('next', '//evil.example');
    render(h(LoginForm));

    await user.type(screen.getByRole('textbox', { name: 'Email' }), lead.email);
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('validates registration and registers then signs in with normalized fields', async () => {
    const user = userEvent.setup();
    state.api.auth.register.mockResolvedValue({});
    render(h(RegisterForm));

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Full name' }), '  Avery Example  ');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), '  avery@example.test  ');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(state.api.auth.register).toHaveBeenCalledWith({ name: 'Avery Example', email: 'avery@example.test', password: 'password123' }));
    expect(state.session.signIn).toHaveBeenCalledWith('avery@example.test', 'password123');
    expect(state.router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('toggles password visibility without changing the entered password', async () => {
    const user = userEvent.setup();
    render(h(PasswordInput, { name: 'password', 'aria-label': 'Password', value: 'secret123', onChange: vi.fn() }));
    const input = screen.getByLabelText('Password');

    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('secret123');
  });
});

describe('projects and membership', () => {
  it('shows project creation to leads, creates a project, and routes to it', async () => {
    const user = userEvent.setup();
    const created = { ...project, id: 'project-new', name: 'New workspace' };
    state.api.projects.create.mockResolvedValue(created);
    const { rerender } = render(h(ProjectsIndex));

    expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute('href', `/projects/${project.id}`);
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New workspace');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(state.api.projects.create).toHaveBeenCalledWith({ name: 'New workspace', description: '' }));
    expect(state.workspace.upsertProject).toHaveBeenCalledWith(created);
    expect(state.router.push).toHaveBeenCalledWith('/projects/project-new');

    state.session.user = { ...state.session.user, role: 'Member' };
    rerender(h(ProjectsIndex));
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('renders project access errors and provides a route back to projects', async () => {
    const user = userEvent.setup();
    state.queries.set('project:forbidden', { data: undefined, error: new ApiError(403, { message: 'Forbidden' }), loading: false });
    render(h(ProjectView, { projectId: 'forbidden' }));

    expect(screen.getByText('You are not a member of this project')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to projects' }));
    expect(state.router.push).toHaveBeenCalledWith('/projects');
  });

  it('shows the access screen for a definitive 403 even when the project is cached', () => {
    setupQuery(`project:${project.id}`, project, { error: new ApiError(403, { message: 'Forbidden' }) });
    setupQuery(`tasks:${project.id}`, [task]);
    render(h(ProjectView, { projectId: project.id }));
    expect(screen.getByText('You are not a member of this project')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(state.workspace.removeProject).toHaveBeenCalledWith(project.id);
  });

  it('keeps cached project data with a retry notice for a transient failure', () => {
    setupQuery(`project:${project.id}`, project, { error: new ApiError(0, null) });
    setupQuery(`tasks:${project.id}`, [task]);
    render(h(ProjectView, { projectId: project.id }));
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText(/refresh/i)).toBeInTheDocument();
    expect(state.workspace.removeProject).not.toHaveBeenCalled();
  });

  it('resolves a ?task= link that is not in the cached list before giving up on it', async () => {
    const tasksQuery = setupQuery(`tasks:${project.id}`, [task]);
    setupQuery(`project:${project.id}`, project);
    state.searchParams.set('task', 'task-new');
    state.api.tasks.get.mockResolvedValueOnce({ ...task, id: 'task-new', title: 'Just assigned' });
    const { unmount } = render(h(ProjectView, { projectId: project.id }));
    await waitFor(() => expect(tasksQuery.setData).toHaveBeenCalledWith(expect.any(Function)));
    expect(state.toast.error).not.toHaveBeenCalled();
    unmount();

    state.searchParams.set('task', 'task-gone');
    state.api.tasks.get.mockRejectedValueOnce(new ApiError(404, { message: 'Task not found.' }));
    render(h(ProjectView, { projectId: project.id }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('That task no longer exists or you can no longer see it.'));
    expect(state.router.replace).toHaveBeenCalledWith(`/projects/${project.id}`, { scroll: false });
  });

  it('creates a task from the project board and adds it to cached project tasks', async () => {
    const user = userEvent.setup();
    const created = { ...task, id: 'task-created', title: 'New from board' };
    const tasksQuery = setupQuery(`tasks:${project.id}`, [task]);
    setupQuery(`project:${project.id}`, project);
    state.api.tasks.create.mockResolvedValue(created);
    render(h(ProjectView, { projectId: project.id }));

    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), created.title);
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(state.api.tasks.create).toHaveBeenCalledWith(project.id, expect.objectContaining({ title: created.title, status: 'To Do' })));
    expect(tasksQuery.setData).toHaveBeenCalledWith(expect.any(Function));
    expect(state.toast.success).toHaveBeenCalledWith('Task created.', expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }));
  });

  it('requires a project name and submits trimmed project fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(project);
    const onOpenChange = vi.fn();
    render(h(ProjectFormDialog, { open: true, onOpenChange, project: null, onSubmit }));

    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText('Give the project a name.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Alpha  ');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), '  Team workspace  ');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Alpha', description: 'Team workspace' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows member management controls only to project managers', async () => {
    const user = userEvent.setup();
    const onMembersChange = vi.fn();
    state.api.members.add.mockResolvedValue(project.members);
    // Signed in as a plain member: read-only list, but they may leave.
    state.session.user = member;
    const { rerender } = render(h(MembersDialog, { open: true, onOpenChange: vi.fn(), project, onMembersChange }));
    expect(screen.getByText('Mina Member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Lena Lead' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Project role for Lena Lead')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave project' })).toBeInTheDocument();

    // The owner gets role pickers, removal and the add form with a role choice.
    state.session.user = lead;
    rerender(h(MembersDialog, { open: true, onOpenChange: vi.fn(), project, onMembersChange }));
    expect(screen.queryByRole('button', { name: 'Leave project' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Project role for Mina Member')).toHaveValue('Member');
    expect(screen.getByLabelText('Role for the new member')).toHaveValue('Member');
    await user.type(screen.getByPlaceholderText('name@example.test'), ' new@example.test ');
    await user.selectOptions(screen.getByLabelText('Role for the new member'), 'Viewer');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(state.api.members.add).toHaveBeenCalledWith(project.id, 'new@example.test', 'Viewer'));
    expect(onMembersChange).toHaveBeenCalledWith(project.members);
  });

  it('changes a project role, and asks before transferring ownership', async () => {
    const user = userEvent.setup();
    const onMembersChange = vi.fn();
    const asViewer = [{ ...lead, projectRole: 'Owner' }, { ...member, projectRole: 'Viewer' }];
    state.api.members.setRole.mockResolvedValueOnce(asViewer);
    render(h(MembersDialog, { open: true, onOpenChange: vi.fn(), project, onMembersChange }));

    await user.selectOptions(screen.getByLabelText('Project role for Mina Member'), 'Viewer');
    await waitFor(() => expect(state.api.members.setRole).toHaveBeenCalledWith(project.id, member.id, 'Viewer'));
    expect(onMembersChange).toHaveBeenCalledWith(asViewer, { unassignedId: member.id });

    await user.selectOptions(screen.getByLabelText('Project role for Mina Member'), 'Owner');
    expect(state.api.members.setRole).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole('group', { name: 'Confirm making Mina Member the owner' });
    expect(screen.getByText(/You will become a manager/)).toBeInTheDocument();
    state.api.members.setRole.mockResolvedValueOnce([{ ...lead, projectRole: 'Manager' }, { ...member, projectRole: 'Owner' }]);
    await user.click(within(confirm).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(state.api.members.setRole).toHaveBeenLastCalledWith(project.id, member.id, 'Owner'));
  });
});

describe('task creation, search, and board', () => {
  it('validates task title and submits trimmed fields, dates, priority, and assignees', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(task);
    render(h(TaskForm, { members: [member], submitLabel: 'Create task', onSubmit }));

    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByText('Give the task a title.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '  Review release  ');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), '  Check the notes  ');
    await user.selectOptions(screen.getByLabelText('Status'), 'In Progress');
    await user.selectOptions(screen.getByLabelText('Priority'), 'High');
    await user.type(screen.getByLabelText('Due date'), '2026-11-01');
    await user.click(screen.getByRole('checkbox', { name: /Mina Member/ }));
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      title: 'Review release',
      description: 'Check the notes',
      status: 'In Progress',
      priority: 'High',
      dueDate: '2026-11-01',
      assigneeIds: [member.id],
    }));
  });

  it('maps API field errors back onto the task form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, { fields: { title: 'Title is already used.' }, message: 'Invalid task.' }));
    render(h(TaskForm, { members: [], onSubmit }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Release');
    await user.click(screen.getByRole('button', { name: 'Save task' }));

    expect(await screen.findByText('Title is already used.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid task.');
  });

  it('combines task search, status, priority, and assignee filters', () => {
    const tasks = [
      { ...task, id: 'a', title: 'Review release', status: 'To Do', priority: 'High', assigneeIds: [member.id] },
      { ...task, id: 'b', title: 'Write docs', description: 'Release documentation', status: 'Done', priority: 'Low', assigneeIds: [lead.id] },
    ];
    expect(applyFilters(tasks, { q: ' RELEASE ', status: 'To Do', priority: 'High', assigneeId: member.id })).toEqual([tasks[0]]);
    expect(applyFilters(tasks, { q: 'missing', status: '', priority: '', assigneeId: '' })).toEqual([]);
  });

  it('updates filter state and clears active filters from the search controls', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters = { q: '', status: '', priority: '', assigneeId: '' };
    const { rerender } = render(h(TaskFilters, { filters, onChange, members: [member], resultCount: 1 }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'release' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, q: 'release' });
    rerender(h(TaskFilters, { filters: { ...filters, q: 'release' }, onChange, members: [member], resultCount: 1 }));
    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(onChange).toHaveBeenLastCalledWith({ q: '', status: '', priority: '', assigneeId: '' });
    expect(screen.getByText('1 task')).toBeInTheDocument();
  });

  it('opens a selected task from the task list and displays project context', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(h(TaskList, {
      tasks: [task],
      membersById: new Map([[member.id, member]]),
      projectsById: new Map([[project.id, project]]),
      onOpen,
    }));

    await user.click(screen.getByRole('button', { name: /Review release/ }));
    expect(onOpen).toHaveBeenCalledWith(task);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('renders status columns and wires board create and open actions', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    render(h(KanbanBoard, { tasks: [task], members: [member], onMove: vi.fn(), onOpen, canCreate: true, onCreate, canDrag: false }));

    expect(screen.getByRole('heading', { name: /To Do/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /In Progress/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Done/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add task to In Progress' }));
    expect(onCreate).toHaveBeenCalledWith('In Progress');
    await user.click(screen.getByRole('heading', { name: /Review release/ }));
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it('lets members change status while hiding lead-only task actions', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const permissions = { edit: false, remove: false, status: true, comment: true, moderate: false };
    render(h(TaskSheet, { task, members: [member], permissions, open: true, onOpenChange: vi.fn(), onStatusChange, onUpdated: vi.fn(), onDeleted: vi.fn() }));

    expect(screen.getByRole('heading', { name: 'Review release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'Done');
    expect(onStatusChange).toHaveBeenCalledWith(task.id, 'Done');
  });

  it('shows a viewer the task read-only: no status control, no edit or delete', () => {
    setupQuery(`comments:${task.id}`, []);
    const permissions = { edit: false, remove: false, status: false, comment: true, moderate: false };
    render(h(TaskSheet, { task, members: [member], permissions, open: true, onOpenChange: vi.fn(), onStatusChange: vi.fn(), onUpdated: vi.fn(), onDeleted: vi.fn() }));
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // Viewers may still comment.
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });
});

describe('comments and notifications', () => {
  it('posts a comment as text and uses optimistic list updates', async () => {
    const user = userEvent.setup();
    const created = { id: 'comment-1', text: '<img src=x onerror=alert(1)>', author: member, createdAt: '2026-10-30T12:00:00.000Z' };
    const query = setupQuery('comments:task-001', [], { setData: vi.fn() });
    state.api.comments.create.mockResolvedValue(created);
    render(h(CommentThread, { taskId: task.id }));

    expect(screen.getByText('No comments yet. Start the conversation.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Add a comment' }), created.text);
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(state.api.comments.create).toHaveBeenCalledWith(task.id, created.text));
    expect(query.setData).toHaveBeenCalledWith(expect.any(Function));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('lets a project lead confirm deletion of a comment and updates the list', async () => {
    const user = userEvent.setup();
    const existing = { id: 'comment-1', text: 'Remove this note', authorId: member.id, author: member, createdAt: '2026-10-30T12:00:00.000Z' };
    const query = setupQuery(`comments:${task.id}`, [existing], { setData: vi.fn() });
    state.api.comments.remove.mockResolvedValue(undefined);
    const { rerender } = render(h(CommentThread, { taskId: task.id, canModerate: false }));
    // Someone else's comment can only be deleted by a moderator (owner, manager or admin).
    expect(screen.queryByRole('button', { name: 'Delete comment by Mina Member' })).not.toBeInTheDocument();
    rerender(h(CommentThread, { taskId: task.id, canModerate: true }));

    await user.click(screen.getByRole('button', { name: 'Delete comment by Mina Member' }));
    expect(screen.getByRole('dialog', { name: 'Delete comment?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete comment', exact: true }));

    await waitFor(() => expect(state.api.comments.remove).toHaveBeenCalledWith(task.id, existing.id));
    expect(query.setData).toHaveBeenCalledWith(expect.any(Function));
  });

  it('filters notifications to unread items and marks unread notifications read', async () => {
    const user = userEvent.setup();
    setupQuery('notifications', {
      items: [
        { id: 'notice-1', type: 'assignment', message: 'New task assigned', read: false, projectId: project.id, taskId: task.id, createdAt: '2026-10-30T12:00:00.000Z' },
        { id: 'notice-2', type: 'due-date', message: 'Task due soon', read: true, projectId: project.id, taskId: task.id, createdAt: '2026-10-29T12:00:00.000Z' },
      ],
      unreadCount: 1,
    });
    state.api.notifications.markAllRead.mockResolvedValue({ updated: 1 });
    render(h(NotificationsPage));

    await user.click(screen.getByRole('button', { name: 'Unread (1)' }));
    expect(screen.getByText('New task assigned')).toBeInTheDocument();
    expect(screen.queryByText('Task due soon')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(state.api.notifications.markAllRead).toHaveBeenCalledOnce());
    expect(state.workspace.setUnread).toHaveBeenCalledWith(0);
    expect(state.toast.success).toHaveBeenCalledWith('All caught up.');
  });
});

describe('dashboard, cross-project search, and profile', () => {
  it('shows dashboard task counts for the signed-in user and project summaries', () => {
    state.queries.set(`dashboard:${lead.id}:${localToday()}`, {
      data: {
        myTasks: [
        { ...task, id: 'mine-open', title: 'Open and due', assigneeIds: [lead.id], dueDate: '2026-11-01', status: 'To Do' },
        { ...task, id: 'mine-done', title: 'Finished', assigneeIds: [lead.id], dueDate: null, status: 'Done' },
        { ...task, id: 'other', title: 'Other person task', assigneeIds: [member.id], dueDate: '2026-11-01' },
        ],
        projects: [{ projectId: project.id, total: 2, overdue: 0, counts: { 'To Do': 1, 'In Progress': 0, Done: 1 } }],
      },
      error: null,
      loading: false,
      setData: vi.fn(),
      reload: vi.fn(),
    });
    render(h(Dashboard));

    expect(screen.getByRole('heading', { name: /Lena/ })).toBeInTheDocument();
    expect(screen.getByText('Open and due')).toBeInTheDocument();
    expect(screen.queryByText('Other person task')).not.toBeInTheDocument();
    expect(screen.getByText('1/2 done')).toBeInTheDocument();
  });

  it('shows zero counts and retries once when a project summary is missing', async () => {
    const reload = vi.fn();
    state.queries.set(`dashboard:${lead.id}:${localToday()}`, { data: { projects: [], myTasks: [], stats: { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 } }, error: null, reload });
    const view = render(h(Dashboard));
    expect(screen.getByText('0/0 done')).toBeInTheDocument();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    view.rerender(h(Dashboard));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows only the error state when the dashboard has no data', () => {
    state.queries.set(`dashboard:${lead.id}:${localToday()}`, { data: undefined, error: new Error('offline'), reload: vi.fn() });
    render(h(Dashboard));
    expect(screen.queryByText('Summary unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps dashboard data and offers retry when refresh fails', () => {
    const reload = vi.fn();
    state.queries.set(`dashboard:${lead.id}:${localToday()}`, { data: { projects: [{ projectId: project.id, total: 0, counts: { 'To Do': 0, 'In Progress': 0, Done: 0 }, overdue: 0 }], myTasks: [], stats: { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 } }, error: new Error('offline'), reload });
    render(h(Dashboard));
    expect(screen.getByText('0/0 done')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('searches tasks assigned to the current user and can switch to everyone', async () => {
    const user = userEvent.setup();
    setupQuery(`search:{"assigneeId":"${lead.id}"}`, [{ ...task, assigneeIds: [lead.id] }]);
    render(h(MyTasks));

    expect(screen.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(task.title)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(screen.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('validates and saves display-name changes and rejects a weak new password', async () => {
    const user = userEvent.setup();
    state.api.users.updateMe.mockResolvedValue({ ...state.session.user, name: 'Updated Lead' });
    render(h(ProfilePage));

    const name = screen.getByRole('textbox', { name: 'Display name' });
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    await user.type(name, 'Updated Lead');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(state.api.users.updateMe).toHaveBeenCalledWith({ name: 'Updated Lead' }));
    expect(state.session.setUser).toHaveBeenCalledWith({ ...state.session.user, name: 'Updated Lead' });

    await user.type(screen.getByLabelText('Current password'), 'current123');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('Use 8+ characters with a letter and a number.')).toBeInTheDocument();
  });
});

describe('member removal, admin users, and insights', () => {
  it('asks before removing a member and blocks adding someone who is already a member', async () => {
    const user = userEvent.setup();
    const onMembersChange = vi.fn();
    state.api.members.remove.mockResolvedValue([lead]);
    render(h(MembersDialog, { open: true, onOpenChange: vi.fn(), project, onMembersChange }));

    await user.click(screen.getByRole('button', { name: 'Remove Mina Member' }));
    expect(state.api.members.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Confirm removing Mina Member' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm removing Mina Member' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Mina Member' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirm removing Mina Member' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.api.members.remove).toHaveBeenCalledWith(project.id, member.id));
    expect(onMembersChange).toHaveBeenCalledWith([lead], { removedId: member.id });

    await user.type(screen.getByPlaceholderText('name@example.test'), 'MINA@example.test');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByText('Mina Member is already a member.')).toBeInTheDocument();
    expect(state.api.members.add).not.toHaveBeenCalled();
  });

  it('keeps the users page to admins', () => {
    render(h(UsersAdmin));
    expect(screen.getByRole('heading', { name: 'Admins only' })).toBeInTheDocument();
    expect(state.api.users.list).not.toHaveBeenCalled();
  });

  it('lists users for an admin and changes a role with undo', async () => {
    const user = userEvent.setup();
    state.session.user = { id: 'user-admin-001', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin' };
    const admin = { ...state.session.user, projectCount: 1, createdAt: '2026-10-01T00:00:00.000Z' };
    const query = setupQuery('admin-users:::', {
      items: [admin, { ...member, projectCount: 2, createdAt: '2026-10-02T00:00:00.000Z' }],
      page: 1, pageSize: 50, total: 2, roleCounts: { Admin: 1, Lead: 0, Member: 1 },
    });
    state.api.users.setRole.mockResolvedValue({ ...member, role: 'Lead' });
    render(h(UsersAdmin));

    expect(screen.getByLabelText('Role for Ada Admin')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Role for Mina Member'), 'Lead');
    await waitFor(() => expect(state.api.users.setRole).toHaveBeenCalledWith(member.id, 'Lead'));
    expect(query.setData).toHaveBeenCalled();
    const [message, options] = state.toast.success.mock.calls[0];
    expect(message).toBe('Mina Member is now a Lead.');
    expect(options.action.label).toBe('Undo');
  });

  it('deactivates an account only after confirming, and never offers it for your own account', async () => {
    const user = userEvent.setup();
    state.session.user = { id: 'user-admin-001', name: 'Ada Admin', email: 'ada@example.test', role: 'Admin' };
    const query = setupQuery('admin-users:::', {
      items: [{ ...state.session.user, projectCount: 1, active: true }, { ...member, projectCount: 2, active: true }],
      page: 1, pageSize: 50, total: 2, roleCounts: { Admin: 1, Lead: 0, Member: 1 }, deactivatedCount: 0,
    });
    state.api.users.setActive.mockResolvedValue({ ...member, active: false });
    render(h(UsersAdmin));

    expect(screen.queryByRole('button', { name: 'Deactivate Ada Admin' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate Mina Member' }));
    expect(state.api.users.setActive).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('group', { name: 'Confirm deactivating Mina Member' })).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(state.api.users.setActive).toHaveBeenCalledWith(member.id, false));
    expect(query.setData).toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalledWith('Mina Member was deactivated and signed out everywhere.');
  });

  it('shows project workload, due dates and priorities as text-backed charts with a table view', async () => {
    const user = userEvent.setup();
    const today = localToday();
    render(h(ProjectInsights, {
      members: project.members,
      tasks: [
        { ...task, id: 't1', status: 'To Do', dueDate: '2000-01-01', assigneeIds: [member.id] },
        { ...task, id: 't2', status: 'Done', dueDate: today, assigneeIds: [member.id, lead.id] },
        { ...task, id: 't3', status: 'In Progress', dueDate: null, priority: 'Low', assigneeIds: [] },
      ],
    }));
    const workload = screen.getByRole('list', { name: 'Tasks per member by status' });
    expect(within(workload).getByText('Mina Member')).toBeInTheDocument();
    expect(within(workload).getByText(/To Do 1, In Progress 0, Done 1/)).toBeInTheDocument();
    expect(within(workload).getByText('Unassigned')).toBeInTheDocument();
    const due = screen.getByRole('list', { name: 'Open tasks by due date' });
    expect(within(due).getByTitle('Overdue: 1 task')).toBeInTheDocument();
    expect(within(due).getByTitle('No due date: 1 task')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Tasks per member by status' });
    expect(within(table).getByRole('rowheader', { name: 'Mina Member' })).toBeInTheDocument();
  });
});

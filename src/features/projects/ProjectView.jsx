'use client';

import { RefreshNotice } from '@/components/ui/RefreshNotice';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NumberFlow from '@number-flow/react';
import { BarChart3, Download, FolderX, Globe, KanbanSquare, List, MoreHorizontal, Pencil, Plus, Rows3, Trash2, Users } from 'lucide-react';
import { statusKey } from '@/components/charts/Charts';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { TASK_STATUSES } from '@/lib/constants';
import { isOverdue } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { can, projectRoleOf } from '@/lib/permissions';
import { forecastProject } from '@/lib/forecast';
import { localToday } from '@/lib/dates';
import { rankBetween } from '@/lib/sprints';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Menu } from '@/components/ui/Menu';
import { VisibilityBadge } from '@/components/ui/Tags';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { KanbanBoard } from '@/features/board/KanbanBoard';
import { TaskFilters, EMPTY_FILTERS, applyFilters, hasActiveFilters } from '@/features/tasks/TaskFilters';
import { TaskForm } from '@/features/tasks/TaskForm';
import { TaskList } from '@/features/tasks/TaskList';
import { QuickAdd } from '@/features/tasks/QuickAdd';
import { TaskSheet } from '@/features/tasks/TaskSheet';
import { WorkItemContext, buildWorkItemIndex } from '@/features/tasks/work-item-context';
import { BacklogView } from '@/features/sprints/BacklogView';
import { MembersDialog } from './MembersDialog';
import { ProjectInsights } from './ProjectInsights';
import { ProjectFormDialog } from './ProjectFormDialog';
import './projects.css';

const VIEW_KEY = 'taskline.projectView';

// Kept in memory too, so switching views still works where storage is blocked.
let memoryView = null;

function readView() {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return saved === 'list' || saved === 'insights' || saved === 'backlog' ? saved : 'board';
  } catch {
    return memoryView || 'board';
  }
}

function subscribeToView(onChange) {
  window.addEventListener('storage', onChange);
  window.addEventListener('taskline:project-view-change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('taskline:project-view-change', onChange);
  };
}

function downloadText(filename, text, type, { bom = false } = {}) {
  // A UTF-8 byte-order mark makes Excel read non-ASCII names correctly instead of as mojibake.
  const url = URL.createObjectURL(new Blob(bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), text] : [text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SummaryStrip({ tasks }) {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
  const overdue = tasks.filter(isOverdue).length;
  const total = tasks.length || 1;
  const percent = tasks.length ? Math.round((counts.Done / tasks.length) * 100) : 0;
  return (
    <div className="summary-strip" aria-label="Project summary">
      <div className="summary-bar" aria-hidden="true">
        {TASK_STATUSES.map((s) => (
          <span key={s} className="summary-bar-part" data-status={s.toLowerCase().replace(' ', '-')} style={{ flexGrow: counts[s] / total }} />
        ))}
      </div>
      <dl className="summary-stats">
        {TASK_STATUSES.map((s) => (
          <div key={s}>
            <dt>
              <span className="chart-swatch" data-status={statusKey(s)} aria-hidden="true" /> {s}
            </dt>
            <dd className="tabular">
              <NumberFlow value={counts[s]} />
            </dd>
          </div>
        ))}
        <div data-tone={overdue ? 'danger' : undefined}>
          <dt>Overdue</dt>
          <dd className="tabular">
            <NumberFlow value={overdue} />
          </dd>
        </div>
        <div>
          <dt>Complete</dt>
          <dd className="tabular">
            <NumberFlow value={percent} suffix="%" />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function JoinGate({ projectId, onJoined }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const join = async () => {
    setJoining(true);
    try {
      const joined = await api.projects.join(projectId);
      onJoined(joined);
      toast.success(`You joined ${joined.name}.`);
      // The join invalidates this project's queries, so the board loads in place.
    } catch (error) {
      toast.error(describeError(error));
      setJoining(false);
    }
  };
  return (
    <div className="join-gate">
      <EmptyState
        icon={Globe}
        title="This project is open to everyone"
        action={
          <div className="state-actions">
            <Button variant="primary" loading={joining} onClick={join}>
              Join project
            </Button>
            <Button variant="ghost" onClick={() => router.push('/projects')}>
              Back to projects
            </Button>
          </div>
        }
      >
        Join it as a member to see the board, add tasks and comment.
      </EmptyState>
    </div>
  );
}

export function ProjectView({ projectId }) {
  const router = useRouter();
  const params = useSearchParams();
  const user = useSession((s) => s.user);
  const { upsertProject, removeProject, loadUnread } = useWorkspace();
  const project = useQuery(`project:${projectId}`, () => api.projects.get(projectId));
  const tasks = useQuery(`tasks:${projectId}`, () => api.tasks.listByProject(projectId));
  const sprints = useQuery(`sprints:${projectId}`, () => api.sprints.list(projectId));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Board and list can show only the active sprint's work (issue #76).
  const [sprintOnly, setSprintOnly] = useState(false);
  const view = useSyncExternalStore(subscribeToView, readView, () => 'board');
  const [createStatus, setCreateStatus] = useState(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedId = params.get('task');
  const selectedTask = tasks.data?.find((t) => t.id === selectedId) || null;
  const missingTask = Boolean(selectedId && tasks.data && !selectedTask);

  // 403 and 404 are definitive (membership revoked or project deleted): cached data is stale,
  // so they win over it. Anything else (network, 5xx) keeps the cached view with a retry notice.
  const lostStatus = [project.error?.status, tasks.error?.status].find((status) => status === 403 || status === 404);
  useEffect(() => {
    if (lostStatus) removeProject(projectId);
  }, [lostStatus, projectId, removeProject]);

  const openTask = useCallback(
    (taskId) => router.replace(`/projects/${projectId}?task=${encodeURIComponent(taskId)}`, { scroll: false }),
    [router, projectId],
  );
  const closeTask = useCallback(() => router.replace(`/projects/${projectId}`, { scroll: false }), [router, projectId]);

  // ?task= names a task the (possibly cached) list does not have: it may be brand new, in another
  // project, or deleted. Ask the API instead of guessing, and say so when it is really gone.
  const setTasks = tasks.setData;
  useEffect(() => {
    if (!missingTask) return undefined;
    let cancelled = false;
    api.tasks.get(selectedId).then(
      (found) => {
        if (cancelled) return;
        if (found.projectId === projectId) setTasks((list) => (list.some((t) => t.id === found.id) ? list : [...list, found]));
        else router.replace(`/projects/${encodeURIComponent(found.projectId)}?task=${encodeURIComponent(found.id)}`);
      },
      (error) => {
        if (cancelled) return;
        toast.error(error?.status === 404 || error?.status === 403 ? 'That task no longer exists or you can no longer see it.' : describeError(error));
        closeTask();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [missingTask, selectedId, projectId, setTasks, router, closeTask]);

  const changeView = (next) => {
    memoryView = next;
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Preference only.
    }
    window.dispatchEvent(new Event('taskline:project-view-change'));
  };

  const activeSprint = sprints.data?.find((sprint) => sprint.state === 'active') ?? null;
  const filteredTasks = useMemo(() => applyFilters(tasks.data || [], filters, project.data), [tasks.data, filters, project.data]);
  const scoped = Boolean(activeSprint && sprintOnly);
  const visibleTasks = useMemo(
    () => (scoped ? filteredTasks.filter((task) => task.sprintId === activeSprint.id) : filteredTasks),
    [filteredTasks, scoped, activeSprint],
  );
  // The forecast always uses every task in the project (filters only change what is shown).
  const forecast = useMemo(() => (tasks.data ? forecastProject(tasks.data, { today: localToday() }) : null), [tasks.data]);
  const membersById = useMemo(() => new Map((project.data?.members || []).map((m) => [m.id, m])), [project.data]);
  // Epics, their items and the project's labels, for cards, rows, the form and the sheet.
  const workItems = useMemo(() => buildWorkItemIndex(tasks.data || [], sprints.data || []), [tasks.data, sprints.data]);

  // Optimistic planning (backlog order and sprints) with rollback, like moveTask below.
  const planTask = useCallback(
    async (taskId, placement) => {
      const list = tasks.data || [];
      const previous = list.find((t) => t.id === taskId);
      if (!previous) return;
      const rankOf = (id) => list.find((t) => t.id === id)?.rank ?? null;
      const placing = Boolean(placement.previousId || placement.nextId);
      const guess = placing ? rankBetween(rankOf(placement.previousId), rankOf(placement.nextId)) : null;
      const optimistic = {
        ...previous,
        ...(placement.sprintId !== undefined ? { sprintId: placement.sprintId } : {}),
        ...(guess ? { rank: guess.rank } : {}),
      };
      tasks.setData((current) => current.map((t) => (t.id === taskId ? optimistic : t)));
      try {
        const saved = await api.tasks.move(taskId, placement);
        tasks.setData((current) => current.map((t) => (t.id === taskId ? saved : t)));
        // A crowded gap makes the server renumber the project: fetch the new ranks.
        if (guess?.crowded) tasks.reload();
      } catch (error) {
        tasks.setData((current) => current.map((t) => (t.id === taskId ? previous : t)));
        toast.error(`Could not move the task. ${describeError(error)}`);
      }
    },
    [tasks],
  );

  // Optimistic status change with rollback (TM-F-012, TM-F-023).
  const moveTask = useCallback(
    async (taskId, status) => {
      const previous = tasks.data?.find((t) => t.id === taskId);
      if (!previous || previous.status === status) return;
      const optimisticCompletedAt = status === 'Done' ? new Date().toISOString() : null;
      tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, status, completedAt: optimisticCompletedAt } : t)));
      try {
        const result = await api.tasks.setStatus(taskId, status);
        tasks.setData((list) => list.map((t) => (t.id === taskId
          ? { ...t, status: result.status, completedAt: result.completedAt === undefined ? optimisticCompletedAt : result.completedAt, sprintId: result.sprintId === undefined ? t.sprintId : result.sprintId, updatedAt: result.updatedAt || t.updatedAt }
          : t)));
      } catch (error) {
        tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, status: previous.status, completedAt: previous.completedAt ?? null } : t)));
        toast.error(`Could not move the task. ${describeError(error)}`);
      }
    },
    [tasks],
  );

  // An open project the user is not in yet: offer to join instead of a dead end.
  if (project.error?.errorCode === 'JOIN_REQUIRED') {
    return <JoinGate projectId={projectId} onJoined={upsertProject} />;
  }

  if ((project.error && !project.data) || lostStatus) {
    const status = lostStatus || project.error.status;
    return (
      <EmptyState
        icon={FolderX}
        title={status === 403 ? 'You are not a member of this project' : status === 404 ? 'This project does not exist' : 'This project did not load'}
        action={
          <Button variant="primary" onClick={() => router.push('/projects')}>
            Back to projects
          </Button>
        }
      >
        {status === 403 ? 'It is private. Ask its owner or a manager to add you.' : status === 404 ? 'It may have been deleted.' : describeError(project.error)}
      </EmptyState>
    );
  }

  if (!project.data) {
    return (
      <div className="project-skeleton" role="status" aria-label="Loading project">
        <Skeleton width={260} height={34} />
        <Skeleton width={420} height={14} />
        <div className="board" style={{ marginTop: 28 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={360} radius="var(--radius-lg)" />
          ))}
        </div>
      </div>
    );
  }

  const p = project.data;
  // Same rules the API enforces (src/lib/permissions.js), so nothing is offered that would be refused.
  const allowed = (action) => can(user, action, p);
  const myRole = projectRoleOf(p, user?.id) ?? (user?.role === 'Admin' ? 'Admin' : null);
  const canCreateTask = allowed('task.create');
  const assignable = p.members.filter((m) => m.projectRole !== 'Viewer' && m.active !== false);
  const menuItems = [
    allowed('project.edit') ? { label: 'Edit project', icon: Pencil, onSelect: () => setEditOpen(true) } : null,
    { label: allowed('members.manage') ? 'Manage members' : 'View members', icon: Users, onSelect: () => setMembersOpen(true) },
    ...(allowed('project.delete')
      ? [{ separator: true }, { label: 'Delete project', icon: Trash2, tone: 'danger', onSelect: () => setDeleteOpen(true) }]
      : []),
  ].filter(Boolean);

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await api.projects.exportCsv(p.id, {
        q: filters.q || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        assigneeId: filters.assigneeId || undefined,
        type: filters.type || undefined,
        label: filters.label || undefined,
      });
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
      downloadText(`${slug}-tasks.csv`, csv, 'text/csv;charset=utf-8', { bom: true });
      toast.success(hasActiveFilters(filters) ? 'Exported the filtered tasks.' : 'Exported all tasks.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteProject = async () => {
    setDeleting(true);
    try {
      await api.projects.remove(p.id);
      removeProject(p.id);
      toast.success('Project deleted.');
      router.replace('/projects');
    } catch (error) {
      toast.error(describeError(error));
      setDeleting(false);
    }
  };

  return (
    <WorkItemContext value={workItems}>
      <div className="project">
        <header className="project-header">
          <div className="project-heading">
            <div className="project-title-row">
              <h1 className="page-title">{p.name}</h1>
              {p.key ? (
                <span className="project-key" title="Project key: tasks are numbered with it">
                  <span className="visually-hidden">Key </span>
                  {p.key}
                </span>
              ) : null}
              <VisibilityBadge visibility={p.visibility} />
              {myRole ? (
                <span className="role-badge" data-role={myRole.toLowerCase()} title="Your role in this project">
                  {myRole === 'Admin' ? 'Admin access' : myRole}
                </span>
              ) : null}
            </div>
            {p.description ? <p className="page-description">{p.description}</p> : null}
          </div>
          <div className="page-actions">
            {/* Named by its content, not aria-label, so the visible initials need not be in the name (WCAG 2.5.3). */}
            <button type="button" className="members-button" onClick={() => setMembersOpen(true)}>
              <AvatarStack users={p.members} max={4} decorative />
              <Users size={15} aria-hidden="true" />
              <span className="tabular" aria-hidden="true">
                {p.members.length}
              </span>
              <span className="visually-hidden">Members: {p.members.length}</span>
            </button>
            <Button onClick={handleExport} loading={exporting}>
              <Download size={16} /> Export CSV
            </Button>
            {canCreateTask ? (
              <Button variant="primary" onClick={() => setCreateStatus('To Do')}>
                <Plus size={16} /> New task
              </Button>
            ) : null}
            <Menu
              trigger={<Button iconOnly aria-label="Project options" />}
              triggerContent={<MoreHorizontal size={16} />}
              items={menuItems}
            />
          </div>
        </header>

        {tasks.data ? <SummaryStrip tasks={tasks.data} /> : null}

        <div className="project-toolbar">
          <TaskFilters filters={filters} onChange={setFilters} members={p.members} labels={workItems.labels} showStatus={view !== 'board'} resultCount={hasActiveFilters(filters) ? visibleTasks.length : undefined} />
          {activeSprint && (view === 'board' || view === 'list') ? (
            <div className="view-toggle" role="group" aria-label="Show">
              <button type="button" aria-pressed={!sprintOnly} onClick={() => setSprintOnly(false)}>
                All tasks
              </button>
              <button type="button" aria-pressed={sprintOnly} onClick={() => setSprintOnly(true)} title={activeSprint.name}>
                Active sprint
              </button>
            </div>
          ) : null}
          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}>
              <KanbanSquare size={16} aria-hidden="true" /> Board
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>
              <List size={16} aria-hidden="true" /> List
            </button>
            <button type="button" aria-pressed={view === 'backlog'} onClick={() => changeView('backlog')}>
              <Rows3 size={16} aria-hidden="true" /> Backlog
            </button>
            <button type="button" aria-pressed={view === 'insights'} onClick={() => changeView('insights')}>
              <BarChart3 size={16} aria-hidden="true" /> Insights
            </button>
          </div>
        </div>

        {canCreateTask && tasks.data && view !== 'insights' ? (
          <QuickAdd
            projectId={p.id}
            members={assignable}
            currentUserId={user?.id}
            onCreated={(created) => {
              tasks.setData((list) => [...(list || []), created]);
              toast.success(`Added "${created.title}".`, { action: { label: 'Open', onClick: () => openTask(created.id) } });
            }}
          />
        ) : null}

        {project.error && project.data && <RefreshNotice onRetry={project.reload} />}
        {tasks.error && tasks.data && <RefreshNotice onRetry={tasks.reload} />}
        {tasks.error && !tasks.data ? (
          <ErrorState error={tasks.error} title="Tasks did not load" onRetry={tasks.reload} />
        ) : !tasks.data ? (
          <div className="board">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={360} radius="var(--radius-lg)" />
            ))}
          </div>
        ) : tasks.data.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            action={
              canCreateTask ? (
                <Button variant="primary" onClick={() => setCreateStatus('To Do')}>
                  <Plus size={16} /> Create the first task
                </Button>
              ) : null
            }
          >
            {canCreateTask ? 'Break the work into tasks and assign them to members.' : 'You can view this project. Members add tasks here.'}
          </EmptyState>
        ) : view === 'backlog' ? (
          sprints.error && !sprints.data ? (
            <ErrorState error={sprints.error} title="Sprints did not load" onRetry={sprints.reload} />
          ) : !sprints.data ? (
            <Skeleton height={240} radius="var(--radius-lg)" />
          ) : (
            <BacklogView
              project={p}
              tasks={filteredTasks}
              allTasks={tasks.data}
              sprints={sprints.data}
              members={p.members}
              today={localToday()}
              canPlan={allowed('task.edit')}
              canManage={allowed('sprint.manage')}
              onPlan={planTask}
              onOpen={openTask}
              onSprintsChange={sprints.setData}
              filtered={hasActiveFilters(filters)}
            />
          )
        ) : view === 'insights' ? (
          <ProjectInsights tasks={visibleTasks} allTasks={tasks.data} forecast={forecast} members={p.members} sprints={sprints.data ?? []} onOpenTask={openTask} />
        ) : view === 'board' ? (
          <KanbanBoard tasks={visibleTasks} members={p.members} risk={forecast?.risk} onMove={moveTask} onOpen={openTask} canCreate={canCreateTask} canDrag={allowed('task.status')} onCreate={setCreateStatus} />
        ) : visibleTasks.length ? (
          <TaskList tasks={visibleTasks} membersById={membersById} risk={forecast?.risk} onOpen={(t) => openTask(t.id)} />
        ) : (
          <EmptyState title="No tasks match these filters" tone="quiet" action={<Button size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>} />
        )}

        <TaskSheet
          key={selectedTask?.id || 'no-task'}
          task={selectedTask}
          members={p.members}
          assignable={assignable}
          risk={selectedTask ? forecast?.risk.get(selectedTask.id) : undefined}
          permissions={{
            edit: allowed('task.edit'),
            remove: allowed('task.delete'),
            status: allowed('task.status'),
            comment: allowed('comment.create'),
            moderate: allowed('comment.moderate'),
          }}
          open={Boolean(selectedTask)}
          onOpenChange={(open) => !open && closeTask()}
          onStatusChange={moveTask}
          onUpdated={(updated) => {
            tasks.setData((list) => list.map((t) => (t.id === updated.id ? updated : t)));
            loadUnread();
          }}
          onDeleted={(taskId) => {
            closeTask();
            // Deleting an epic keeps its items, now outside any epic (as the API does).
            tasks.setData((list) => list.filter((t) => t.id !== taskId).map((t) => (t.epicId === taskId ? { ...t, epicId: null } : t)));
          }}
          onOpenTask={openTask}
          onChecklistChange={(taskId, checklist, updatedAt) => {
            tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, checklist, updatedAt: updatedAt || t.updatedAt } : t)));
          }}
        />

        <Modal open={Boolean(createStatus)} onOpenChange={(open) => !open && setCreateStatus(null)} title="New task" description={`Adds a task to ${p.name}.`}>
          {createStatus ? (
            <TaskForm
              initial={{ status: createStatus }}
              members={assignable}
              submitLabel="Create task"
              onCancel={() => setCreateStatus(null)}
              onSubmit={async (payload) => {
                const created = await api.tasks.create(p.id, payload);
                tasks.setData((list) => [...(list || []), created]);
                setCreateStatus(null);
                toast.success('Task created.', { action: { label: 'Open', onClick: () => openTask(created.id) } });
              }}
            />
          ) : null}
        </Modal>

        <MembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          project={p}
          onMembersChange={(members, { removedId, unassignedId } = {}) => {
            // Someone who leaves (or removes themselves) loses access; admins keep it.
            if (removedId && removedId === user?.id && user.role !== 'Admin') {
              removeProject(p.id);
              setMembersOpen(false);
              toast.success(`You left ${p.name}.`);
              router.replace('/projects');
              return;
            }
            const next = {
              ...p,
              members,
              memberIds: members.map((m) => m.id),
              ownerId: members.find((m) => m.projectRole === 'Owner')?.id ?? p.ownerId,
              managerIds: members.filter((m) => m.projectRole === 'Manager').map((m) => m.id),
              viewerIds: members.filter((m) => m.projectRole === 'Viewer').map((m) => m.id),
            };
            project.setData(next);
            upsertProject(next);
            const dropped = removedId || unassignedId;
            if (dropped) tasks.setData((list) => list.map((t) => ({ ...t, assigneeIds: t.assigneeIds.filter((id) => id !== dropped) })));
          }}
        />

        <ProjectFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          project={p}
          canEditKey={allowed('project.key')}
          onSubmit={async (input) => {
            const updated = await api.projects.update(p.id, input);
            project.setData(updated);
            upsertProject(updated);
            // A new key renames every task key; api.projects.update invalidates the task list, so it refetches.
            toast.success(input.key ? `Project updated. Tasks are now ${updated.key}-1, ${updated.key}-2 …` : 'Project updated.');
          }}
        />

        <Modal open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete this project?" description="All of its tasks, comments and notifications are deleted. This cannot be undone.">
          <p className="confirm-subject">{p.name}</p>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Keep project
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDeleteProject}>
              Delete project
            </Button>
          </div>
        </Modal>
      </div>
    </WorkItemContext>
  );
}

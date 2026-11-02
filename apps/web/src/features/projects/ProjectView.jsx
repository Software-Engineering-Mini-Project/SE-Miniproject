'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NumberFlow from '@number-flow/react';
import { Download, FolderX, KanbanSquare, List, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { TASK_STATUSES } from '@/lib/constants';
import { isOverdue } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Menu } from '@/components/ui/Menu';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { KanbanBoard } from '@/features/board/KanbanBoard';
import { TaskFilters, EMPTY_FILTERS, applyFilters, hasActiveFilters } from '@/features/tasks/TaskFilters';
import { TaskForm } from '@/features/tasks/TaskForm';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskSheet } from '@/features/tasks/TaskSheet';
import { MembersDialog } from './MembersDialog';
import { ProjectFormDialog } from './ProjectFormDialog';
import './projects.css';

const VIEW_KEY = 'taskline.projectView';

function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
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
            <dt>{s}</dt>
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
      </dl>
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('board');
  const [createStatus, setCreateStatus] = useState(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => setView(readView()), []);

  const selectedId = params.get('task');
  const selectedTask = tasks.data?.find((t) => t.id === selectedId) || null;

  const openTask = useCallback(
    (taskId) => router.replace(`/projects/${projectId}?task=${encodeURIComponent(taskId)}`, { scroll: false }),
    [router, projectId],
  );
  const closeTask = useCallback(() => router.replace(`/projects/${projectId}`, { scroll: false }), [router, projectId]);

  const changeView = (next) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Preference only.
    }
  };

  const visibleTasks = useMemo(() => applyFilters(tasks.data || [], filters), [tasks.data, filters]);
  const membersById = useMemo(() => new Map((project.data?.members || []).map((m) => [m.id, m])), [project.data]);

  // Optimistic status change with rollback (TM-F-012, TM-F-023).
  const moveTask = useCallback(
    async (taskId, status) => {
      const previous = tasks.data?.find((t) => t.id === taskId);
      if (!previous || previous.status === status) return;
      tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, status } : t)));
      try {
        const result = await api.tasks.setStatus(taskId, status);
        tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, status: result.status, updatedAt: result.updatedAt || t.updatedAt } : t)));
      } catch (error) {
        tasks.setData((list) => list.map((t) => (t.id === taskId ? { ...t, status: previous.status } : t)));
        toast.error(`Could not move the task. ${describeError(error)}`);
      }
    },
    [tasks],
  );

  if (project.error) {
    const status = project.error.status;
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
        {status === 403 ? 'Ask the project lead to add you.' : describeError(project.error)}
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
  const canManage = user?.role === 'Admin' || (user?.role === 'Lead' && p.memberIds.includes(user.id));

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await api.projects.exportCsv(p.id, {
        q: filters.q || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        assigneeId: filters.assigneeId || undefined,
      });
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
      downloadText(`${slug}-tasks.csv`, csv, 'text/csv;charset=utf-8');
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
    <div className="project">
      <header className="project-header">
        <div className="project-heading">
          <h1 className="page-title">{p.name}</h1>
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
          {canManage ? (
            <>
              <Button variant="primary" onClick={() => setCreateStatus('To Do')}>
                <Plus size={16} /> New task
              </Button>
              <Menu
                trigger={<Button iconOnly aria-label="Project options" />}
                triggerContent={<MoreHorizontal size={16} />}
                items={[
                  { label: 'Edit project', icon: Pencil, onSelect: () => setEditOpen(true) },
                  { label: 'Manage members', icon: Users, onSelect: () => setMembersOpen(true) },
                  { separator: true },
                  { label: 'Delete project', icon: Trash2, tone: 'danger', onSelect: () => setDeleteOpen(true) },
                ]}
              />
            </>
          ) : null}
        </div>
      </header>

      {tasks.data ? <SummaryStrip tasks={tasks.data} /> : null}

      <div className="project-toolbar">
        <TaskFilters filters={filters} onChange={setFilters} members={p.members} showStatus={view === 'list'} resultCount={hasActiveFilters(filters) ? visibleTasks.length : undefined} />
        <div className="view-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}>
            <KanbanSquare size={16} aria-hidden="true" /> Board
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>
            <List size={16} aria-hidden="true" /> List
          </button>
        </div>
      </div>

      {tasks.error ? (
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
            canManage ? (
              <Button variant="primary" onClick={() => setCreateStatus('To Do')}>
                <Plus size={16} /> Create the first task
              </Button>
            ) : null
          }
        >
          {canManage ? 'Break the work into tasks and assign them to members.' : 'The project lead has not added tasks yet.'}
        </EmptyState>
      ) : view === 'board' ? (
        <KanbanBoard tasks={visibleTasks} members={p.members} onMove={moveTask} onOpen={openTask} canCreate={canManage} onCreate={setCreateStatus} />
      ) : visibleTasks.length ? (
        <TaskList tasks={visibleTasks} membersById={membersById} onOpen={(t) => openTask(t.id)} />
      ) : (
        <EmptyState title="No tasks match these filters" tone="quiet" action={<Button size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>} />
      )}

      <TaskSheet
        task={selectedTask}
        members={p.members}
        canManage={canManage}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => !open && closeTask()}
        onStatusChange={moveTask}
        onUpdated={(updated) => {
          tasks.setData((list) => list.map((t) => (t.id === updated.id ? updated : t)));
          loadUnread();
        }}
        onDeleted={(taskId) => {
          closeTask();
          tasks.setData((list) => list.filter((t) => t.id !== taskId));
        }}
      />

      <Modal open={Boolean(createStatus)} onOpenChange={(open) => !open && setCreateStatus(null)} title="New task" description={`Adds a task to ${p.name}.`}>
        {createStatus ? (
          <TaskForm
            initial={{ status: createStatus }}
            members={p.members}
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
        canManage={canManage}
        onMembersChange={(members, removedId) => {
          const next = { ...p, members, memberIds: members.map((m) => m.id) };
          project.setData(next);
          upsertProject(next);
          if (removedId) tasks.setData((list) => list.map((t) => ({ ...t, assigneeIds: t.assigneeIds.filter((id) => id !== removedId) })));
        }}
      />

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={p}
        onSubmit={async (input) => {
          const updated = await api.projects.update(p.id, input);
          project.setData(updated);
          upsertProject(updated);
          toast.success('Project updated.');
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
  );
}

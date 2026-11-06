'use client';

import { RefreshNotice } from '@/components/ui/RefreshNotice';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, List, SearchX } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { plural } from '@/lib/format';
import { localToday } from '@/lib/dates';
import { groupUpcoming } from '@/lib/upcoming';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import { EMPTY_FILTERS, TaskFilters, hasActiveFilters } from './TaskFilters';
import { TaskList } from './TaskList';
import './tasks.css';
import '@/features/projects/projects.css';

const VIEW_KEY = 'taskline.myTasksView';
const VIEW_EVENT = 'taskline:my-tasks-view-change';

// Kept in memory too, so the toggle still works where storage is blocked.
let memoryView = null;

function savedView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'upcoming' ? 'upcoming' : 'list';
  } catch {
    return memoryView || 'list';
  }
}

function subscribeToView(onChange) {
  window.addEventListener('storage', onChange);
  window.addEventListener(VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(VIEW_EVENT, onChange);
  };
}

function changeView(next) {
  memoryView = next;
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}

/** Open tasks as an agenda: overdue, today, tomorrow, the days after, later, undated. */
function UpcomingView({ tasks, membersById, projectsById, onOpen }) {
  const groups = useMemo(() => groupUpcoming(tasks, localToday()), [tasks]);
  const doneCount = tasks.filter((task) => task.status === 'Done').length;
  if (!groups.length) {
    return (
      <EmptyState icon={CalendarDays} title="Nothing coming up" tone="quiet">
        Every task here is done.
      </EmptyState>
    );
  }
  return (
    <div className="agenda">
      {groups.map((group) => (
        <section key={group.key} className="agenda-day" aria-labelledby={`agenda-${group.key}`} data-tone={group.tone}>
          <h2 id={`agenda-${group.key}`} className="agenda-title">
            {group.label}
            <span className="agenda-count tabular">{group.tasks.length}</span>
          </h2>
          <TaskList tasks={group.tasks} membersById={membersById} projectsById={projectsById} onOpen={onOpen} />
        </section>
      ))}
      {doneCount ? <p className="agenda-note">{plural(doneCount, 'done task')} not shown.</p> : null}
    </div>
  );
}

/** Search across every authorized project (TM-F-040), using GET /tasks with filters. */
export function MyTasks() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const projects = useWorkspace((s) => s.projects);
  const [scope, setScope] = useState('mine');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [query, setQuery] = useState(EMPTY_FILTERS);
  const view = useSyncExternalStore(subscribeToView, savedView, () => 'list');

  // Debounce typing; selects apply immediately.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filters), filters.q === query.q ? 0 : 250);
    return () => clearTimeout(timer);
  }, [filters, query.q]);

  const params = useMemo(() => {
    const p = { ...query, assigneeId: scope === 'mine' ? user?.id : query.assigneeId };
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v));
  }, [query, scope, user]);

  // The assignee filter only exists for "Everyone"; never carry a hidden choice across scopes.
  const changeScope = (next) => {
    setScope(next);
    setFilters((f) => ({ ...f, assigneeId: '' }));
    setQuery((q) => ({ ...q, assigneeId: '' }));
  };

  const results = useQuery(user ? `search:${JSON.stringify(params)}` : null, () => api.tasks.search(params));
  const projectsById = useMemo(() => new Map((projects || []).map((p) => [p.id, p])), [projects]);
  const membersById = useMemo(() => {
    const map = new Map();
    (projects || []).forEach((p) => p.members.forEach((m) => map.set(m.id, m)));
    return map;
  }, [projects]);
  const allMembers = useMemo(() => [...membersById.values()], [membersById]);
  const openTask = (task) => router.push(`/projects/${task.projectId}?task=${task.id}`);
  const sorted = useMemo(
    () => [...(results.data || [])].sort((a, b) => (a.status === 'Done') - (b.status === 'Done') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [results.data],
  );

  return (
    <>
      <PageHeader title="My tasks" description="Search and filter tasks across every project you belong to." />

      <div className="project-toolbar">
        <TaskFilters
          filters={filters}
          onChange={setFilters}
          members={scope === 'all' ? allMembers : []}
          resultCount={results.data ? results.data.length : undefined}
        />
        <div className="toolbar-toggles">
          <div className="view-toggle" role="group" aria-label="Whose tasks">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => changeScope('mine')}>
              Assigned to me
            </button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => changeScope('all')}>
              Everyone
            </button>
          </div>
          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>
              <List size={16} aria-hidden="true" /> List
            </button>
            <button type="button" aria-pressed={view === 'upcoming'} onClick={() => changeView('upcoming')}>
              <CalendarDays size={16} aria-hidden="true" /> Upcoming
            </button>
          </div>
        </div>
      </div>

      {results.error && results.data && <RefreshNotice onRetry={results.reload} />}
      {results.error && !results.data ? (
        <ErrorState error={results.error} onRetry={results.reload} />
      ) : !results.data ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={56} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={SearchX} title={hasActiveFilters(filters) ? 'No tasks match' : scope === 'mine' ? 'Nothing assigned to you' : 'No tasks yet'}>
          {hasActiveFilters(filters) ? 'Try fewer filters or a different search.' : 'Tasks show up here as soon as someone creates them.'}
        </EmptyState>
      ) : view === 'upcoming' ? (
        <UpcomingView tasks={sorted} membersById={membersById} projectsById={projectsById} onOpen={openTask} />
      ) : (
        <TaskList tasks={sorted} membersById={membersById} projectsById={projectsById} onOpen={openTask} />
      )}
    </>
  );
}

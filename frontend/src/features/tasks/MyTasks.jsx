'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchX } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import { EMPTY_FILTERS, TaskFilters, hasActiveFilters } from './TaskFilters';
import { TaskList } from './TaskList';
import './tasks.css';
import '@/features/projects/projects.css';

/** Search across every authorized project (TM-F-040), using GET /tasks with filters. */
export function MyTasks() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const projects = useWorkspace((s) => s.projects);
  const [scope, setScope] = useState('mine');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [query, setQuery] = useState(EMPTY_FILTERS);

  // Debounce typing; selects apply immediately.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filters), filters.q === query.q ? 0 : 250);
    return () => clearTimeout(timer);
  }, [filters, query.q]);

  const params = useMemo(() => {
    const p = { ...query, assigneeId: scope === 'mine' ? user?.id : query.assigneeId };
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v));
  }, [query, scope, user]);

  const results = useQuery(user ? `search:${JSON.stringify(params)}` : null, () => api.tasks.search(params));
  const projectsById = useMemo(() => new Map((projects || []).map((p) => [p.id, p])), [projects]);
  const membersById = useMemo(() => {
    const map = new Map();
    (projects || []).forEach((p) => p.members.forEach((m) => map.set(m.id, m)));
    return map;
  }, [projects]);
  const allMembers = useMemo(() => [...membersById.values()], [membersById]);
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
        <div className="view-toggle" role="group" aria-label="Whose tasks">
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
            Assigned to me
          </button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Everyone
          </button>
        </div>
      </div>

      {results.error ? (
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
      ) : (
        <TaskList
          tasks={sorted}
          membersById={membersById}
          projectsById={projectsById}
          onOpen={(task) => router.push(`/projects/${task.projectId}?task=${task.id}`)}
        />
      )}
    </>
  );
}

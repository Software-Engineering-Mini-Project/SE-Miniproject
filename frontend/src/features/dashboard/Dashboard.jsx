'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import NumberFlow from '@number-flow/react';
import { ArrowRight, CalendarCheck2, FolderKanban } from 'lucide-react';
import { api } from '@/lib/api/client';
import { TASK_STATUSES } from '@/lib/constants';
import { daysUntil, firstName, isOverdue, plural } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { DueTag, PriorityTag } from '@/components/ui/Tags';
import { PRIORITY_META } from '@/lib/constants';
import './dashboard.css';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const todayLabel = () => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function Stat({ label, value, tone, hint }) {
  return (
    <div className="stat" data-tone={tone}>
      <dt>{label}</dt>
      <dd className="tabular">
        <NumberFlow value={value} />
      </dd>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

function ProjectSummaryRow({ project }) {
  // TM-F-041: counts come from the summary endpoint, scoped to authorized projects.
  const summary = useQuery(`summary:${project.id}`, () => api.projects.summary(project.id));
  const s = summary.data;
  const total = s?.total || 1;
  return (
    <li>
      <Link href={`/projects/${project.id}`} className="project-summary">
        <span className="project-summary-name">{project.name}</span>
        {s ? (
          <>
            <span className="project-summary-bar" aria-hidden="true">
              {TASK_STATUSES.map((status) => (
                <span key={status} data-status={status.toLowerCase().replace(' ', '-')} style={{ flexGrow: s.counts[status] / total }} />
              ))}
            </span>
            <span className="project-summary-counts">
              {s.counts.Done}/{s.total} done
              {s.overdue ? <strong> · {s.overdue} overdue</strong> : null}
            </span>
          </>
        ) : summary.error ? (
          <span className="project-summary-counts">Summary unavailable</span>
        ) : (
          <Skeleton width="100%" height={8} />
        )}
        <ArrowRight size={16} className="project-summary-arrow" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function Dashboard() {
  const user = useSession((s) => s.user);
  const projects = useWorkspace((s) => s.projects);
  const tasks = useQuery(user ? `dashboard:${user.id}` : null, () => api.tasks.search({}));
  const projectsById = useMemo(() => new Map((projects || []).map((p) => [p.id, p])), [projects]);

  const mine = useMemo(() => (tasks.data || []).filter((t) => t.assigneeIds.includes(user?.id)), [tasks.data, user]);
  const open = mine.filter((t) => t.status !== 'Done');
  const overdue = open.filter(isOverdue);
  const dueThisWeek = open.filter((t) => {
    const days = daysUntil(t.dueDate);
    return days !== null && days >= 0 && days <= 7;
  });
  const attention = [...open]
    .filter((t) => t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank)
    .slice(0, 6);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <p className="dashboard-date">{todayLabel()}</p>
        <h1 className="page-title">
          {greeting()}, {firstName(user?.name)}
        </h1>
      </header>

      {tasks.error ? (
        <ErrorState error={tasks.error} onRetry={tasks.reload} />
      ) : (
        <>
          <dl className="stats" aria-busy={!tasks.data}>
            <Stat label="Assigned to you" value={open.length} hint="Not done yet" />
            <Stat label="Due in 7 days" value={dueThisWeek.length} tone={dueThisWeek.length ? 'warn' : undefined} />
            <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'danger' : undefined} />
            <Stat label="Completed" value={mine.length - open.length} tone="good" />
          </dl>

          <div className="dashboard-grid">
            <section className="panel dashboard-panel" aria-labelledby="attention-title">
              <div className="panel-head">
                <h2 id="attention-title">Next up for you</h2>
                <Link href="/tasks" className="panel-link">
                  All my tasks
                </Link>
              </div>
              {!tasks.data ? (
                <div className="attention-list">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} height={52} />
                  ))}
                </div>
              ) : attention.length === 0 ? (
                <EmptyState icon={CalendarCheck2} title="Nothing due" tone="quiet">
                  {mine.length ? 'You have no open tasks with a due date.' : 'Tasks assigned to you will show up here.'}
                </EmptyState>
              ) : (
                <ul className="attention-list">
                  {attention.map((task) => (
                    <li key={task.id}>
                      <Link href={`/projects/${task.projectId}?task=${task.id}`} className="attention-item" data-overdue={isOverdue(task) || undefined}>
                        <span className="attention-main">
                          <span className="attention-title">{task.title}</span>
                          <span className="attention-project">{projectsById.get(task.projectId)?.name}</span>
                        </span>
                        <span className="attention-meta">
                          <PriorityTag priority={task.priority} />
                          <DueTag task={task} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel dashboard-panel" aria-labelledby="projects-title">
              <div className="panel-head">
                <h2 id="projects-title">Projects</h2>
                <Link href="/projects" className="panel-link">
                  View all
                </Link>
              </div>
              {projects === null ? (
                <div className="attention-list">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} height={52} />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <EmptyState icon={FolderKanban} title="No projects yet" tone="quiet">
                  A project lead adds you to projects. You can still update your profile meanwhile.
                </EmptyState>
              ) : (
                <>
                  <ul className="project-summaries">
                    {projects.map((project) => (
                      <ProjectSummaryRow key={project.id} project={project} />
                    ))}
                  </ul>
                  <p className="panel-foot">{plural(projects.length, 'project')} you can access</p>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

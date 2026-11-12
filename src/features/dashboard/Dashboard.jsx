'use client';

import { RefreshNotice } from '@/components/ui/RefreshNotice';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import NumberFlow from '@number-flow/react';
import { ArrowRight, CalendarCheck2, FolderKanban } from 'lucide-react';
import { BarList, StatusBar, StatusLegend, statusSummary } from '@/components/charts/Charts';
import { dueBuckets } from '@/lib/insights';
import { localToday } from '@/lib/dates';
import { firstName, isOverdue, plural } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/hooks/useQuery';
import { api } from '@/lib/api/client';
import { useWorkspace } from '@/lib/workspace';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { DueTag, PriorityTag, TaskKey } from '@/components/ui/Tags';
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
      <dd className="stat-value tabular">
        <NumberFlow value={value} />
      </dd>
      {hint ? <dd className="stat-hint">{hint}</dd> : null}
    </div>
  );
}

function ProjectSummaryRow({ project, summary, error }) {
  const s = summary || { total: 0, counts: { 'To Do': 0, 'In Progress': 0, Done: 0 }, overdue: 0 };
  return (
    <li>
      <Link href={`/projects/${project.id}`} className="project-summary">
        <span className="project-summary-name">{project.name}</span>
        {error && !summary ? (
          <span className="project-summary-counts">Summary unavailable</span>
        ) : (
          <>
            <StatusBar counts={s.counts} total={s.total} className="project-summary-bar" />
            <span className="project-summary-counts">
              {s.counts.Done}/{s.total} done
              {s.overdue ? <strong> · {s.overdue} overdue</strong> : null}
              <span className="visually-hidden">: {statusSummary(s.counts)}</span>
            </span>
          </>
        )}
        <ArrowRight size={16} className="project-summary-arrow" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function Dashboard() {
  const user = useSession((s) => s.user);
  const projects = useWorkspace((s) => s.projects);
  const today = localToday();
  const dashboard = useQuery(user ? `dashboard:${user.id}:${today}` : null, () => api.dashboard.get(today));
  const { data: dashboardData, reload: reloadDashboard } = dashboard;
  const tasks = dashboard.data?.myTasks;
  const summariesByProjectId = useMemo(() => new Map((dashboard.data?.projects || []).map((item) => [item.projectId, item])), [dashboard.data]);
  const missingProjects = (projects || []).filter((project) => !summariesByProjectId.has(project.id)).map((project) => project.id).join(',');
  const lastMissing = useRef('');
  useEffect(() => {
    if (dashboardData && missingProjects && lastMissing.current !== missingProjects) {
      lastMissing.current = missingProjects;
      reloadDashboard();
    } else if (!missingProjects) lastMissing.current = '';
  }, [dashboardData, reloadDashboard, missingProjects]);
  const projectsById = useMemo(() => new Map((projects || []).map((p) => [p.id, p])), [projects]);

  const mine = useMemo(() => (tasks || []).filter((t) => t.assigneeIds.includes(user?.id)), [tasks, user]);
  const open = mine.filter((t) => t.status !== 'Done');
  const stats = dashboard.data?.stats || { openAssigned: 0, dueIn7Days: 0, overdue: 0, completed: 0 };
  const attention = [...open]
    .filter((t) => t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank)
    .slice(0, 6);
  const due = dueBuckets(open, today).map((b) => (b.key === 'overdue' ? { ...b, tone: 'danger' } : b));

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <p className="dashboard-date">{todayLabel()}</p>
        <h1 className="page-title">
          {greeting()}, {firstName(user?.name)}
        </h1>
      </header>

      {dashboard.error && !dashboard.data ? (
        <><ErrorState error={dashboard.error} onRetry={dashboard.reload} /></>
      ) : (
        <>
          {dashboard.error && <RefreshNotice onRetry={dashboard.reload} />}
          <dl className="stats" aria-busy={!dashboard.data}>
            <Stat label="Assigned to you" value={stats.openAssigned} hint="Not done yet" />
            <Stat label="Due in 7 days" value={stats.dueIn7Days} tone={stats.dueIn7Days ? 'warn' : undefined} />
            <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'danger' : undefined} />
            <Stat label="Completed" value={stats.completed} tone="good" />
          </dl>

          <div className="dashboard-grid">
            <section className="panel dashboard-panel" aria-labelledby="attention-title">
              <div className="panel-head">
                <h2 id="attention-title">Next up for you</h2>
                <Link href="/tasks" className="panel-link">
                  All my tasks
                </Link>
              </div>
              {!dashboard.data ? (
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
                          <span className="attention-project">
                            <TaskKey value={task.key} />
                            {task.key ? ' · ' : null}
                            {projectsById.get(task.projectId)?.name}
                          </span>
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

            <div className="dashboard-side">
            <section className="panel dashboard-panel" aria-labelledby="projects-title">
              <div className="panel-head">
                <h2 id="projects-title">Projects</h2>
                <Link href="/projects" className="panel-link">
                  View all
                </Link>
              </div>
              {projects?.length && dashboard.data ? <StatusLegend className="panel-legend" /> : null}
              {projects === null || !dashboard.data ? (
                <div className="attention-list">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} height={52} />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <EmptyState
                  icon={FolderKanban}
                  title="No projects yet"
                  tone="quiet"
                  action={
                    <Link href="/projects" className="btn" data-variant="secondary" data-size="sm">
                      <span className="btn-label">Create or join a project</span>
                    </Link>
                  }
                >
                  Start your own project, join an open one, or ask a project owner to add you.
                </EmptyState>
              ) : (
                <>
                  <ul className="project-summaries">
                    {projects.map((project) => (
                      <ProjectSummaryRow key={project.id} project={project} summary={summariesByProjectId.get(project.id)} error={dashboard.error} />
                    ))}
                  </ul>
                  <p className="panel-foot">{plural(projects.length, 'project')} you can access</p>
                </>
              )}
            </section>

            <section className="panel dashboard-panel" aria-labelledby="due-chart-title">
              <div className="panel-head">
                <h2 id="due-chart-title">When your work is due</h2>
                <span className="panel-meta">{plural(open.length, 'open task')}</span>
              </div>
              {!dashboard.data ? (
                <div className="attention-list">
                  <Skeleton height={150} />
                </div>
              ) : open.length === 0 ? (
                <EmptyState icon={CalendarCheck2} title="Nothing open" tone="quiet">
                  Nothing assigned to you is waiting.
                </EmptyState>
              ) : (
                <div className="panel-body">
                  <BarList items={due} label="Your open tasks by due date" />
                </div>
              )}
            </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

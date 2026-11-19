'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NumberFlow from '@number-flow/react';
import { Building2, Check, Copy, FolderKanban, KeyRound, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { StatusBar, statusSummary } from '@/components/charts/Charts';
import { localToday } from '@/lib/dates';
import { plural } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { ORGANISATION_NAME_MAX } from '@/lib/organisation';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { RefreshNotice } from '@/components/ui/RefreshNotice';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { VisibilityBadge } from '@/components/ui/Tags';
import { PageHeader } from '@/components/shell/PageHeader';
import { InvitationsPanel } from './InvitationsPanel';
import '@/features/dashboard/dashboard.css';
import '@/features/projects/projects.css';
import './organisation.css';

function Stat({ label, value, hint, tone }) {
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

/**
 * The organisation page: who we are, how many people and projects, and how every project is
 * doing. Admins also get the invite code and the name; people see the projects they are in plus
 * the open ones.
 */
export function OrganisationPage() {
  const user = useSession((s) => s.user);
  const admin = user?.role === 'Admin';
  const today = localToday();
  const details = useQuery(`organisation:details:${user?.id}`, () => api.organisation.get());
  const overview = useQuery(`organisation:overview:${user?.id}:${today}`, () => api.organisation.overview(today));

  const organisation = details.data;
  const totals = overview.data?.totals;
  const name = organisation?.name ?? user?.organisation?.name ?? 'Organisation';

  return (
    <>
      <PageHeader
        title={name}
        description={
          admin
            ? 'Everything your organisation is working on. As an admin you can open every project.'
            : 'Your organisation: the projects you are in and the open ones you can join.'
        }
        actions={
          admin ? (
            <Link href="/admin/users" className="btn" data-variant="secondary">
              <span className="btn-label">
                <UsersRound size={16} /> Manage people
              </span>
            </Link>
          ) : null
        }
      />
      {details.error && overview.error && !organisation && !overview.data ? (
        <ErrorState error={details.error} title="The organisation did not load" onRetry={() => { details.reload(); overview.reload(); }} />
      ) : (
        <>
          <dl className="stats" aria-label="Organisation totals" aria-busy={!totals}>
            <Stat label="People" value={organisation?.memberCount ?? totals?.people ?? 0} hint="Active accounts" />
            <Stat label="Projects" value={totals?.projects ?? 0} hint={admin ? 'All of them' : 'You can see'} />
            <Stat label="Open tasks" value={totals ? totals.tasks - totals.done : 0} hint={totals ? `${plural(totals.done, 'task')} done` : undefined} />
            <Stat label="Overdue" value={totals?.overdue ?? 0} tone={totals?.overdue ? 'danger' : undefined} hint="Not done, past due" />
          </dl>
          {admin && organisation ? <AdminPanel organisation={organisation} onChanged={() => details.reload()} /> : null}
          <ProjectList overview={overview} admin={admin} />
        </>
      )}
      {details.error && organisation ? <RefreshNotice onRetry={details.reload} /> : null}
    </>
  );
}

/** Invite code and organisation name: Admins only (the API never sends the code to anyone else). */
function AdminPanel({ organisation, onChanged }) {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState(organisation.name);
  const [nameError, setNameError] = useState(null);
  const [savingName, setSavingName] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const dirty = name.trim() !== organisation.name;

  async function saveName(event) {
    event.preventDefault();
    const next = name.trim();
    if (!next) return setNameError('Name your organisation.');
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await api.organisation.update(next);
      setName(updated.name);
      setUser({ ...user, organisation: { id: updated.id, name: updated.name } });
      onChanged();
      toast.success('Organisation renamed.');
    } catch (error) {
      setNameError(error instanceof ApiError && error.fields?.name ? error.fields.name : describeError(error));
    } finally {
      setSavingName(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(organisation.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the code and copy it by hand.');
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      await api.organisation.rotateJoinCode();
      setConfirming(false);
      onChanged();
      toast.success('New invite code created. The old one no longer works.');
    } catch (error) {
      toast.error(`Could not change the code. ${describeError(error)}`);
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="org-admin">
      <section className="org-card" aria-labelledby="invite-title">
        <h2 id="invite-title" className="org-card-title">
          <KeyRound size={16} aria-hidden="true" /> Invite people
        </h2>
        <p className="org-card-hint">Share this code. Anyone who registers with it joins as a member. Add them to projects from there.</p>
        <div className="invite-row">
          <code className="invite-code" aria-label="Invite code">{organisation.joinCode}</code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {confirming ? (
          <div className="invite-confirm" role="group" aria-label="Replace the invite code">
            <p>Replace the code? The current one stops working straight away. People already in are not affected.</p>
            <div className="invite-confirm-actions">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={rotating}>Keep it</Button>
              <Button variant="primary" size="sm" onClick={rotate} loading={rotating}>Replace code</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Create a new code</Button>
        )}
      </section>

      <section className="org-card" aria-labelledby="org-name-title">
        <h2 id="org-name-title" className="org-card-title">
          <Building2 size={16} aria-hidden="true" /> Organisation name
        </h2>
        <form className="org-name-form" noValidate onSubmit={saveName}>
          <Field label="Name" error={nameError}>
            <input className="input" value={name} maxLength={ORGANISATION_NAME_MAX + 10} onChange={(event) => { setName(event.target.value); setNameError(null); }} />
          </Field>
          <Button type="submit" variant="primary" size="sm" loading={savingName} disabled={!dirty}>
            Save name
          </Button>
        </form>
      </section>

      <InvitationsPanel userId={user?.id} />
    </div>
  );
}

function ProjectList({ overview, admin }) {
  const router = useRouter();
  const upsertProject = useWorkspace((s) => s.upsertProject);
  const [joining, setJoining] = useState(null);
  const projects = overview.data?.projects;

  async function join(project) {
    setJoining(project.id);
    try {
      const joined = await api.projects.join(project.id);
      upsertProject(joined);
      toast.success(`You joined ${joined.name}.`);
      router.push(`/projects/${joined.id}`);
    } catch (error) {
      toast.error(describeError(error));
      setJoining(null);
    }
  }

  return (
    <section className="org-projects" aria-labelledby="org-projects-title">
      <div className="org-projects-head">
        <h2 id="org-projects-title" className="org-projects-title">Projects</h2>
        <Link href="/projects" className="org-projects-link">Open projects page</Link>
      </div>
      {overview.error && !projects ? (
        <ErrorState error={overview.error} title="Projects did not load" onRetry={overview.reload} align="start" />
      ) : !projects ? (
        <div className="org-project-list" aria-hidden="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={76} radius="var(--radius-lg)" />)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          action={<Link href="/projects" className="btn" data-variant="primary"><span className="btn-label">Go to projects</span></Link>}
        >
          Create the first project, or ask an owner to add you to one.
        </EmptyState>
      ) : (
        <ul className="org-project-list">
          {projects.map((project) => {
            const canOpen = Boolean(project.yourRole) || admin;
            const done = project.counts.Done ?? 0;
            return (
              <li key={project.id} className="org-project">
                <div className="org-project-main">
                  <div className="org-project-title">
                    {canOpen ? (
                      <Link href={`/projects/${project.id}`} className="org-project-name">{project.name}</Link>
                    ) : (
                      <h3 className="org-project-name">{project.name}</h3>
                    )}
                    <VisibilityBadge visibility={project.visibility} />
                  </div>
                  <p className="org-project-meta">
                    {project.ownerName ? `Owned by ${project.ownerName} · ` : ''}
                    {plural(project.memberCount, 'member')}
                  </p>
                </div>
                <div className="org-project-progress">
                  <StatusBar counts={project.counts} total={project.total} className="org-progress-bar" />
                  <p className="org-project-figures">
                    <span className="visually-hidden">{statusSummary(project.counts)}. </span>
                    {project.total ? `${done} of ${project.total} done` : 'No tasks yet'}
                    {project.overdue ? <strong className="org-overdue">{project.overdue} overdue</strong> : null}
                  </p>
                </div>
                <div className="org-project-side">
                  {project.yourRole ? (
                    <span className="org-role" title="Your role in this project">{project.yourRole}</span>
                  ) : canOpen ? (
                    <span className="org-role" data-muted>Admin access</span>
                  ) : (
                    <Button size="sm" loading={joining === project.id} disabled={Boolean(joining)} onClick={() => join(project)} aria-label={`Join ${project.name}`}>
                      Join
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

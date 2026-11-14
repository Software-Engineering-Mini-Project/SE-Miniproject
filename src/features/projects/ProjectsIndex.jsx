'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Compass, FolderKanban, Plus, Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { canCreateProject } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { VisibilityBadge } from '@/components/ui/Tags';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import { ProjectFormDialog } from './ProjectFormDialog';
import './projects.css';

export function ProjectsIndex() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { projects, projectsError, loadProjects, upsertProject, settings, loadSettings } = useWorkspace();
  // Loaded here rather than at sign-in: only this page and the admin page need them.
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  const [createOpen, setCreateOpen] = useState(false);
  // Until the settings load, only offer creation to roles that always have it, so the button
  // never appears and then vanishes for a Member in a leads-only organisation.
  const canCreate = settings ? canCreateProject(user, settings) : user?.role === 'Admin' || user?.role === 'Lead';

  const createButton = canCreate ? (
    <Button variant="primary" onClick={() => setCreateOpen(true)}>
      <Plus size={16} /> New project
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Projects"
        description={user?.role === 'Admin' ? 'Every project in the organisation. As an admin you can open and manage all of them.' : 'Projects you are in, and open projects you can join.'}
        actions={createButton}
      />

      {projectsError && !projects ? (
        <ErrorState error={projectsError} title="Projects did not load" onRetry={loadProjects} />
      ) : projects === null ? (
        <ul className="project-grid" aria-label="Loading projects">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton height={150} radius="var(--radius-lg)" />
            </li>
          ))}
        </ul>
      ) : projects.length === 0 ? (
        <GettingStarted canCreate={canCreate} email={user?.email} onCreate={() => setCreateOpen(true)} />
      ) : (
        <ul className="project-grid" aria-label="Your projects">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="project-tile">
                <div>
                  <div className="project-tile-head">
                    <h2 className="project-tile-name">{project.name}</h2>
                    <VisibilityBadge visibility={project.visibility} />
                  </div>
                  {project.description ? <p className="project-tile-desc">{project.description}</p> : null}
                </div>
                <div className="project-tile-foot">
                  <AvatarStack users={project.members} max={4} />
                  <span>
                    {plural(project.members.length, 'member')} · {formatDate(project.updatedAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {projects !== null ? <BrowseProjects onJoined={upsertProject} /> : null}

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          const created = await api.projects.create(input);
          upsertProject(created);
          toast.success('Project created. Add members to start assigning tasks.');
          router.push(`/projects/${created.id}`);
        }}
      />
    </>
  );
}

/** First run: the three ways into a project, instead of a blank page. */
function GettingStarted({ canCreate, email, onCreate }) {
  return (
    <section className="getting-started" aria-labelledby="getting-started-title">
      <h2 id="getting-started-title" className="getting-started-title">Get started</h2>
      <p className="getting-started-lede">You are not in any projects yet. Pick one of these to start working.</p>
      <ol className="start-options">
        <li className="start-option">
          <span className="start-icon" aria-hidden="true"><FolderKanban size={18} /></span>
          <div>
            <h3>Create a project</h3>
            <p>{canCreate ? 'You become its owner, invite your team and plan the work.' : 'In this organisation only leads and admins create projects. Ask an admin if you need one.'}</p>
          </div>
          {canCreate ? (
            <Button variant="primary" size="sm" onClick={onCreate}>
              <Plus size={15} /> New project
            </Button>
          ) : null}
        </li>
        <li className="start-option">
          <span className="start-icon" aria-hidden="true"><Compass size={18} /></span>
          <div>
            <h3>Join an open project</h3>
            <p>Open projects are listed below. Joining makes you a member, so you can add and move tasks.</p>
          </div>
          <a className="btn" data-variant="secondary" data-size="sm" href="#open-projects">
            <span className="btn-label">Browse</span>
          </a>
        </li>
        <li className="start-option">
          <span className="start-icon" aria-hidden="true"><UserPlus size={18} /></span>
          <div>
            <h3>Get added to a private project</h3>
            <p>
              Send your email{email ? <> (<strong className="start-email">{email}</strong>)</> : null} to the project&apos;s owner or a manager.
              It shows up here as soon as they add you.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Open projects the user is not in yet (Jira's "browse projects"). */
function BrowseProjects({ onJoined }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 200);
  const directory = useQuery(`directory:${query}`, () => api.projects.directory(query));
  const [joining, setJoining] = useState(null);

  async function join(entry) {
    setJoining(entry.id);
    try {
      const project = await api.projects.join(entry.id);
      onJoined(project);
      toast.success(`You joined ${project.name}.`);
      router.push(`/projects/${project.id}`);
    } catch (error) {
      toast.error(describeError(error));
      setJoining(null);
    }
  }

  const list = directory.data;
  return (
    <section id="open-projects" className="browse" aria-labelledby="open-projects-title">
      <div className="browse-head">
        <div>
          <h2 id="open-projects-title" className="browse-title">Open projects</h2>
          <p className="browse-lede">Anyone in the organisation can join these as a member.</p>
        </div>
        <div className="input-with-icon browse-search" role="search">
          <Search size={16} aria-hidden="true" />
          <label htmlFor="project-directory-search" className="visually-hidden">
            Search open projects
          </label>
          <input id="project-directory-search" className="input" type="search" value={q} maxLength={80} placeholder="Search open projects" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {directory.error && !list ? (
        <ErrorState error={directory.error} title="Open projects did not load" onRetry={directory.reload} align="start" />
      ) : !list ? (
        <div className="browse-list" aria-hidden="true">
          <Skeleton height={64} radius="var(--radius)" />
        </div>
      ) : list.length === 0 ? (
        <p className="browse-empty">
          {query ? `No open project matches “${query}”.` : 'Nothing to join right now. When someone makes a project Open, it shows up here.'}
        </p>
      ) : (
        <ul className="browse-list">
          {list.map((entry) => (
            <li key={entry.id} className="browse-row">
              <div className="browse-main">
                <h3 className="browse-name">{entry.name}</h3>
                <p className="browse-meta">
                  {entry.ownerName ? `Owned by ${entry.ownerName} · ` : ''}
                  {plural(entry.memberCount, 'member')}
                </p>
                {entry.description ? <p className="browse-desc">{entry.description}</p> : null}
              </div>
              <Button size="sm" loading={joining === entry.id} disabled={Boolean(joining)} onClick={() => join(entry)} aria-label={`Join ${entry.name}`}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

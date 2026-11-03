'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderKanban, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { canManageProjects } from '@/lib/constants';
import { formatDate, plural } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import { ProjectFormDialog } from './ProjectFormDialog';
import './projects.css';

export function ProjectsIndex() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { projects, projectsError, loadProjects, upsertProject } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = canManageProjects(user);

  const createButton = canCreate ? (
    <Button variant="primary" onClick={() => setCreateOpen(true)}>
      <Plus size={16} /> New project
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Projects" description="Every project you are a member of." actions={createButton} />

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
        <EmptyState icon={FolderKanban} title="You are not in any projects yet" action={createButton}>
          {canCreate ? 'Create a project, then add your team as members.' : 'A project lead will add you to a project. It appears here as soon as they do.'}
        </EmptyState>
      ) : (
        <ul className="project-grid">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="project-tile">
                <div>
                  <h2 className="project-tile-name">{project.name}</h2>
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

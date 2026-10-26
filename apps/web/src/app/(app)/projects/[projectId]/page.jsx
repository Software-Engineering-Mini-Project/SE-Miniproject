import { Suspense } from 'react';
import { ProjectView } from '@/features/projects/ProjectView';

export const metadata = { title: 'Project' };

export default async function ProjectPage({ params }) {
  const { projectId } = await params;
  return (
    <Suspense>
      <ProjectView projectId={projectId} />
    </Suspense>
  );
}

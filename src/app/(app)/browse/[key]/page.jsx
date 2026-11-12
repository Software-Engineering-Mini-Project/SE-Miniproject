import { TaskKeyRedirect } from '@/features/tasks/TaskKeyRedirect';

export const metadata = { title: 'Open task' };

export default async function BrowseTaskPage({ params }) {
  const { key } = await params;
  return <TaskKeyRedirect taskKey={decodeURIComponent(key)} />;
}

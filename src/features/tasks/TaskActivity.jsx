'use client';

import { RefreshNotice } from '@/components/ui/RefreshNotice';
import { api } from '@/lib/api/client';
import { describeActivity } from '@/lib/activity';
import { formatDate, formatRelative } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useWorkItems } from './work-item-context';

const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
// Due dates are calendar days; read them at midday so no time zone moves them to another day.
const formatDay = (day) => formatDate(`${day}T12:00:00`);

/**
 * Who changed what on a task, newest first (issue #75): "Mina moved ALPHA-12 from To Do to In
 * Progress · 5 min ago". Sentences come from describeActivity() in src/lib/activity.js.
 */
export function TaskActivity({ task, members = [] }) {
  const activity = useQuery(`activity:${task.id}`, () => api.tasks.activity(task.id));
  const workItems = useWorkItems();
  const membersById = new Map(members.map((member) => [member.id, member]));
  const options = {
    taskKey: task.key,
    nameOf: (id) => membersById.get(id)?.name ?? 'a former member',
    taskTitleOf: (id) => workItems.byId.get(id)?.title ?? null,
    sprintNameOf: (id) => workItems.sprintsById?.get(id)?.name ?? null,
    formatDay,
  };
  const page = activity.data;

  if (activity.error && !page) return <ErrorState error={activity.error} title="The history did not load" onRetry={activity.reload} />;
  if (!page) {
    return (
      <ol className="activity-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="activity-entry">
            <Skeleton width={24} height={24} radius="50%" />
            <Skeleton width="70%" height={12} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <>
      {activity.error ? <RefreshNotice onRetry={activity.reload} /> : null}
      {page.items.length ? (
        <ol className="activity-list" aria-label="Activity, newest first">
          {page.items.map((entry) => (
            <li key={entry.id} className="activity-entry">
              <Avatar user={entry.actor ?? { name: '?' }} size="sm" decorative />
              <p className="activity-text">
                <strong>{entry.actor?.name ?? 'Someone'}</strong> {describeActivity(entry, options)}
                <span className="activity-time">
                  {' · '}
                  <time dateTime={entry.createdAt} title={fullTime.format(new Date(entry.createdAt))}>
                    {formatRelative(entry.createdAt)}
                  </time>
                </span>
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing has happened to this task yet.</p>
      )}
      {page.total > page.items.length ? (
        <p className="muted activity-more">
          Showing the latest {page.items.length} of {page.total} changes.
        </p>
      ) : null}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchX } from 'lucide-react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { parseTaskKey } from '@/lib/work-items';

/**
 * /browse/ALPHA-12: finds the task by its key and opens it on its project. A key the project used
 * before still resolves, so shared links survive a key change. Another organisation's keys and
 * keys that never existed both read as "no task has this key".
 */
export function TaskKeyRedirect({ taskKey }) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const parsed = parseTaskKey(taskKey);

  useEffect(() => {
    if (!parseTaskKey(taskKey)) return undefined;
    let cancelled = false;
    api.tasks.getByKey(taskKey).then(
      (task) => {
        if (!cancelled) router.replace(`/projects/${encodeURIComponent(task.projectId)}?task=${encodeURIComponent(task.id)}`);
      },
      (failure) => {
        if (!cancelled) setError(failure);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskKey, router]);

  const missing = !parsed || (error instanceof ApiError && error.status === 404);
  if (missing) {
    return (
      <EmptyState icon={SearchX} title={`No task has the key ${String(taskKey).toUpperCase()}`} action={<Link className="btn" data-size="sm" href="/tasks"><span className="btn-label">Go to my tasks</span></Link>}>
        Check the key, or ask whoever shared it. Keys look like ALPHA-12.
      </EmptyState>
    );
  }
  if (error) return <ErrorState error={error} title="This task did not open" />;
  return (
    <div className="state-block" data-tone="quiet">
      <Spinner label={`Opening ${String(taskKey).toUpperCase()}`} />
    </div>
  );
}

import Link from 'next/link';
import { EmptyState } from '@/components/ui/States';

export default function NotFound() {
  return (
    <main>
      <EmptyState align="center" title="Page not found" tone="error" action={(
        <Link className="btn" data-size="sm" href="/dashboard">Go to dashboard</Link>
      )}>
        The page you requested does not exist or may have moved.
      </EmptyState>
    </main>
  );
}

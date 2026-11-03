'use client';

import { ErrorState } from '@/components/ui/States';

export default function AppError({ error, reset }) {
  return (
    <div>
      <ErrorState error={error} title="This page did not load" onRetry={reset} />
    </div>
  );
}

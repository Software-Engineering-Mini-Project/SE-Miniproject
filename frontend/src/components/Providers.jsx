'use client';

import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { useSession } from '@/lib/session';

export function Providers({ children }) {
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <>
      {children}
      <Toaster position="bottom-right" closeButton toastOptions={{ className: 'toast' }} />
    </>
  );
}

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { localToday } from '../../src/lib/dates.js';
import { clearQueryCache, useQuery } from '../../src/lib/hooks/useQuery.js';

afterEach(() => { clearQueryCache(); vi.useRealTimers(); });

it('uses a fresh cache key and fetches again when the local date changes', async () => {
  let date = new Date(2026, 9, 15, 12);
  const fetcher = vi.fn(async () => localToday(date));
  const hook = renderHook(() => useQuery(`dashboard:user:${localToday(date)}`, fetcher));
  await waitFor(() => expect(hook.result.current.data).toBe('2026-10-15'));
  date = new Date(2026, 9, 16, 12);
  hook.rerender();
  await waitFor(() => expect(hook.result.current.data).toBe('2026-10-16'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api/client.js';
import { clearQueryCache, useQuery } from '../../src/lib/hooks/useQuery.js';

afterEach(() => { vi.unstubAllGlobals(); clearQueryCache(); });

it('refetches a mounted dashboard after a successful status change', async () => {
  let count = 0;
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/dashboard')) count += 1;
    return { status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ count }) };
  }));
  const hook = renderHook(() => useQuery('dashboard:member', () => api.dashboard.get()));
  await waitFor(() => expect(hook.result.current.data.count).toBe(1));
  await act(() => api.tasks.setStatus('task-1', 'Done'));
  await waitFor(() => expect(hook.result.current.data.count).toBe(2));
});

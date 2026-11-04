import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { clearQueryCache, invalidateQuery, useQuery } from '../../src/lib/hooks/useQuery.js';

const api = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/lib/api/client.js', () => ({
  api: {
    dashboard: { get: vi.fn(async () => ({ count: ++api.count })) },
    tasks: { setStatus: vi.fn(async () => { invalidateQuery('dashboard:'); return { taskId: 'task-1', status: 'Done' }; }) },
  },
}));
import { api as client } from '../../src/lib/api/client.js';

afterEach(() => { clearQueryCache(); api.count = 0; });

it('refetches a mounted dashboard after a successful status change', async () => {
  const hook = renderHook(() => useQuery('dashboard:member', () => client.dashboard.get()));
  await waitFor(() => expect(hook.result.current.data?.count).toBe(1));
  await act(() => client.tasks.setStatus('task-1', 'Done'));
  await waitFor(() => expect(hook.result.current.data?.count).toBe(2));
});

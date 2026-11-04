import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearQueryCache, invalidateQuery, useQuery } from '../../src/lib/hooks/useQuery.js';

const mock = vi.hoisted(() => ({ configure: vi.fn(), login: vi.fn(), me: vi.fn() }));
vi.mock('../../src/lib/api/client.js', () => ({
  api: { auth: { login: mock.login, me: mock.me } },
  configureApi: mock.configure,
}));
import { useSession } from '../../src/lib/session.js';

beforeEach(() => {
  clearQueryCache();
  useSession.setState({ status: 'authenticated', token: 'token', user: { id: 'user-1' }, reason: null });
});

it('returns cached query data immediately and refreshes it in the background', async () => {
  const firstFetcher = vi.fn().mockResolvedValue(['first']);
  const first = renderHook(() => useQuery('projects', firstFetcher));
  await waitFor(() => expect(first.result.current.data).toEqual(['first']));
  first.unmount();

  const secondFetcher = vi.fn().mockResolvedValue(['fresh']);
  const second = renderHook(() => useQuery('projects', secondFetcher));
  expect(second.result.current.data).toEqual(['first']);
  expect(second.result.current.loading).toBe(false);
  await waitFor(() => expect(second.result.current.data).toEqual(['fresh']));
  expect(secondFetcher).toHaveBeenCalledOnce();
});

it('deduplicates concurrent requests for the same query key', async () => {
  let resolve;
  const fetcherA = vi.fn(() => new Promise((done) => { resolve = done; }));
  const fetcherB = vi.fn().mockResolvedValue(['should not run']);
  const first = renderHook(() => useQuery('shared', fetcherA));
  const second = renderHook(() => useQuery('shared', fetcherB));
  await waitFor(() => expect(fetcherA).toHaveBeenCalledOnce());
  expect(fetcherB).not.toHaveBeenCalled();

  await act(async () => resolve(['shared result']));
  await waitFor(() => expect(first.result.current.data).toEqual(['shared result']));
  expect(second.result.current.data).toEqual(['shared result']);
});

it('clears cached data when the session signs out', async () => {
  const fetcher = vi.fn().mockResolvedValue(['private projects']);
  const first = renderHook(() => useQuery('private-projects', fetcher));
  await waitFor(() => expect(first.result.current.data).toEqual(['private projects']));
  first.unmount();

  act(() => useSession.getState().signOut());
  const nextFetcher = vi.fn().mockResolvedValue(['new session data']);
  const second = renderHook(() => useQuery('private-projects', nextFetcher));
  expect(second.result.current.data).toBeUndefined();
  expect(second.result.current.loading).toBe(true);
  await waitFor(() => expect(second.result.current.data).toEqual(['new session data']));
});


it('invalidates a mounted dashboard and keeps good data when a refresh fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ count: 2 });
  const hook = renderHook(() => useQuery('dashboard:user-1', fetcher));
  await waitFor(() => expect(hook.result.current.data).toEqual({ count: 1 }));
  act(() => invalidateQuery('dashboard:'));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(hook.result.current.data).toEqual({ count: 1 });
  await act(() => hook.result.current.reload());
  expect(hook.result.current.data).toEqual({ count: 2 });
});

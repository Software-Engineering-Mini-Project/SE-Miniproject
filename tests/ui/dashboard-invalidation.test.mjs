import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/hooks/useQuery.js', () => ({ invalidateQuery: vi.fn() }));
import { invalidateQuery } from '../../src/lib/hooks/useQuery.js';
import { api } from '../../src/lib/api/client.js';

afterEach(() => vi.unstubAllGlobals());

it('invalidates the dashboard only after successful project, member, and task mutations', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const mutations = [
    () => api.projects.create({}), () => api.projects.update('p', {}), () => api.projects.remove('p'),
    () => api.members.add('p', 'a@example.test'), () => api.members.remove('p', 'u'),
    () => api.tasks.create('p', {}), () => api.tasks.update('t', {}), () => api.tasks.setStatus('t', 'Done'), () => api.tasks.remove('t'),
  ];
  for (const mutate of mutations) {
    vi.mocked(invalidateQuery).mockClear();
    await mutate();
    expect(invalidateQuery).toHaveBeenCalledExactlyOnceWith('dashboard:');
  }
  for (const mutate of [() => api.comments.create('t', 'hi'), () => api.comments.remove('t', 'c'), () => api.notifications.markAllRead()]) {
    vi.mocked(invalidateQuery).mockClear();
    await mutate();
    expect(invalidateQuery).not.toHaveBeenCalled();
  }
  fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }));
  vi.mocked(invalidateQuery).mockClear();
  await expect(api.projects.remove('p')).rejects.toThrow();
  expect(invalidateQuery).not.toHaveBeenCalled();
});

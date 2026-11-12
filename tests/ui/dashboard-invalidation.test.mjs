import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/hooks/useQuery.js', () => ({ invalidateQuery: vi.fn() }));
import { invalidateQuery } from '../../src/lib/hooks/useQuery.js';
import { api } from '../../src/lib/api/client.js';

afterEach(() => vi.unstubAllGlobals());

it('invalidates the dashboard only after successful project, member, and task mutations', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const mutations = [
    () => api.projects.create({}), () => api.projects.remove('p'),
    () => api.members.add('p', 'a@example.test'), () => api.members.remove('p', 'u'),
    () => api.tasks.create('p', {}), () => api.tasks.update('t', {}), () => api.tasks.setStatus('t', 'Done'), () => api.tasks.remove('t'),
  ];
  for (const mutate of mutations) {
    vi.mocked(invalidateQuery).mockClear();
    await mutate();
    // A task's own history (activity:<id>) is refreshed too where the change writes to it.
    expect(vi.mocked(invalidateQuery).mock.calls.flat().filter((key) => !key.startsWith('activity:'))).toEqual(['dashboard:', 'organisation:']);
  }
  for (const [mutate, key] of [
    [() => api.tasks.update('t', {}), 'activity:t'], [() => api.tasks.setStatus('t', 'Done'), 'activity:t'], [() => api.members.remove('p', 'u'), 'activity:'],
  ]) {
    vi.mocked(invalidateQuery).mockClear();
    await mutate();
    expect(invalidateQuery).toHaveBeenCalledWith(key);
  }
  // Editing a project can change its visibility and its key (and so every task key), and joining changes what the project and its tasks return.
  vi.mocked(invalidateQuery).mockClear();
  await api.projects.update('p', {});
  expect(vi.mocked(invalidateQuery).mock.calls.flat()).toEqual(['dashboard:', 'organisation:', 'directory:', 'tasks:p', 'search:']);
  vi.mocked(invalidateQuery).mockClear();
  await api.projects.join('p');
  expect(vi.mocked(invalidateQuery).mock.calls.flat()).toEqual(['dashboard:', 'organisation:', 'directory:', 'project:p', 'tasks:p']);
  for (const mutate of [() => api.comments.create('t', 'hi'), () => api.comments.remove('t', 'c'), () => api.notifications.markAllRead()]) {
    vi.mocked(invalidateQuery).mockClear();
    await mutate();
    expect(vi.mocked(invalidateQuery).mock.calls.flat().filter((key) => key !== 'activity:t')).toEqual([]);
  }
  fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }));
  vi.mocked(invalidateQuery).mockClear();
  await expect(api.projects.remove('p')).rejects.toThrow();
  expect(invalidateQuery).not.toHaveBeenCalled();
});

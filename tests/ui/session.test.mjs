import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ login: vi.fn(), me: vi.fn(), configure: vi.fn() }));
vi.mock('../../src/lib/api/client.js', () => ({
  api: { auth: { login: mock.login, me: mock.me } },
  configureApi: mock.configure,
}));
import { useSession } from '../../src/lib/session.js';

beforeEach(() => {
  useSession.setState({ status: 'anonymous', token: null, user: null, reason: null });
});

it('uses the user returned by login without requesting auth/me', async () => {
  const user = { id: 'user-1', name: 'Example' };
  mock.login.mockResolvedValue({ token: 'token', expiresIn: 7200, user });
  expect(await useSession.getState().signIn('user@example.test', 'password')).toEqual(user);
  expect(mock.me).not.toHaveBeenCalled();
  expect(useSession.getState().user).toEqual(user);
});

it('fetches auth/me for older login responses without a user', async () => {
  mock.login.mockResolvedValue({ token: 'token', expiresIn: 7200 });
  mock.me.mockResolvedValue({ id: 'legacy' });
  expect(await useSession.getState().signIn('user@example.test', 'password')).toEqual({ id: 'legacy' });
  expect(mock.me).toHaveBeenCalledOnce();
});

it('keeps the stored session when restoring fails for a reason other than 401, and retries', async () => {
  window.sessionStorage.setItem('taskline.session', JSON.stringify({ token: 'stored', expiresAt: Date.now() + 60_000 }));
  useSession.setState({ status: 'unknown', token: null, user: null, reason: null });
  mock.me.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
  await useSession.getState().restore();
  expect(useSession.getState().status).toBe('unavailable');
  expect(window.sessionStorage.getItem('taskline.session')).not.toBeNull();

  mock.me.mockResolvedValueOnce({ id: 'user-1' });
  await useSession.getState().retryRestore();
  expect(useSession.getState()).toMatchObject({ status: 'authenticated', token: 'stored', user: { id: 'user-1' } });
});

it('drops the stored session when restoring gets a 401', async () => {
  window.sessionStorage.setItem('taskline.session', JSON.stringify({ token: 'revoked', expiresAt: Date.now() + 60_000 }));
  useSession.setState({ status: 'unknown', token: null, user: null, reason: null });
  mock.me.mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 401 }));
  await useSession.getState().restore();
  expect(useSession.getState()).toMatchObject({ status: 'anonymous', token: null, reason: 'expired' });
  expect(window.sessionStorage.getItem('taskline.session')).toBeNull();
});

it('signing out clears the previous user workspace data', async () => {
  const { useWorkspace } = await import('../../src/lib/workspace.js');
  useWorkspace.setState({ projects: [{ id: 'p' }], unreadCount: 4 });
  useSession.setState({ status: 'authenticated', token: 't', user: { id: 'u' } });
  useSession.getState().signOut();
  expect(useWorkspace.getState()).toMatchObject({ projects: null, unreadCount: 0 });
});

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

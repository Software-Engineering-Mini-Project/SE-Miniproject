import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete window.__taskManagerApiRequestObserver; vi.resetModules(); });

it('does not notify the request observer in production HTTP mode', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_API_MODE', 'http');
  const observer = vi.fn();
  window.__taskManagerApiRequestObserver = observer;
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) })));
  vi.resetModules();
  const { api } = await import('../../src/lib/api/client.js');
  await api.dashboard.get();
  expect(observer).not.toHaveBeenCalled();
});

import { describe, expect, it, vi } from 'vitest';

describe('API base URL', () => {
  it('ignores an external configured URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://external.example/api');
    vi.resetModules();
    const { apiConfig } = await import('../../src/lib/api/client.js');
    expect(apiConfig.baseUrl).toBe('/api');
    vi.unstubAllEnvs();
  });
});

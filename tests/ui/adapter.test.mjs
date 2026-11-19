import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('serverless-http', () => ({ default: () => state.handler }));
vi.mock('../../server/index.js', () => ({ default: () => {} }));
import { POST } from '../../src/app/api/[...path]/route.js';

it('passes the first forwarded IP and JSON body to Express', async () => {
  state.handler.mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' });
  const request = new Request('https://example.test/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.8, 192.0.2.1', 'content-type': 'application/json' },
    body: '{"email":"example"}',
  });
  const response = await POST(request);
  expect(response.status).toBe(200);
  const event = state.handler.mock.calls[0][0];
  expect(event.requestContext.identity.sourceIp).toBe('203.0.113.8');
  expect(event.body).toBe('{"email":"example"}');
  expect(event.isBase64Encoded).toBe(false);
});

it('prefers trusted proxy headers over x-forwarded-for', async () => {
  state.handler.mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' });
  await POST(new Request('https://example.test/api/auth/login', {
    method: 'POST', headers: { 'x-real-ip': '203.0.113.5', 'x-vercel-forwarded-for': '203.0.113.6', 'x-forwarded-for': '192.0.2.2' },
  }));
  expect(state.handler.mock.calls.at(-1)[0].requestContext.identity.sourceIp).toBe('203.0.113.5');
  await POST(new Request('https://example.test/api/auth/login', {
    method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.6', 'x-forwarded-for': '192.0.2.2' },
  }));
  expect(state.handler.mock.calls.at(-1)[0].requestContext.identity.sourceIp).toBe('203.0.113.6');
});

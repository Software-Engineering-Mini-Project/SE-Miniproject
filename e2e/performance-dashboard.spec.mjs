import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const EMAIL = 'lead@example.test';
const isMock = process.env.NEXT_PUBLIC_API_MODE === 'mock';
const EXPECTED = ['GET /dashboard', 'GET /notifications/unread-count', 'GET /projects', 'POST /auth/login'];

test('dashboard performs at most four API requests after sign-in', async ({ page }) => {
  // HTTP mode: count real network calls to /api. Mock mode makes no network calls, so the API
  // client reports each request to an observer instead (enabled for mock builds only).
  const networkRequests = [];
  if (isMock) {
    await page.addInitScript(() => {
      window.__taskManagerApiRequests = [];
      window.__taskManagerApiRequestObserver = (request) => window.__taskManagerApiRequests.push(request);
    });
  } else {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) networkRequests.push({ method: request.method(), path: url.pathname.slice(4) });
    });
  }
  const recorded = async () => (isMock ? page.evaluate(() => window.__taskManagerApiRequests) : [...networkRequests]);
  const names = (requests) => requests.map(({ method, path }) => `${method} ${path}`).sort();

  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
  await expect.poll(async () => names(await recorded())).toEqual(EXPECTED);
  await page.waitForTimeout(500);
  const apiRequests = await recorded();
  expect(apiRequests).toHaveLength(4);
  expect(names(apiRequests)).toEqual(EXPECTED);
});

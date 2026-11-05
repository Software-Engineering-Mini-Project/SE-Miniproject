import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const EMAIL = 'lead@example.test';

test('dashboard performs at most four API requests after sign-in', async ({ page }) => {
  await page.addInitScript(() => {
    window.__taskManagerApiRequests = [];
    window.__taskManagerApiRequestObserver = (request) => window.__taskManagerApiRequests.push(request);
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__taskManagerApiRequests)).map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
    'GET /dashboard', 'GET /notifications/unread-count', 'GET /projects', 'POST /auth/login',
  ]);
  await page.waitForTimeout(500);
  const apiRequests = await page.evaluate(() => window.__taskManagerApiRequests);
  expect(apiRequests).toHaveLength(4);
  expect(apiRequests.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
    'GET /dashboard',
    'GET /notifications/unread-count',
    'GET /projects',
    'POST /auth/login',
  ]);
});

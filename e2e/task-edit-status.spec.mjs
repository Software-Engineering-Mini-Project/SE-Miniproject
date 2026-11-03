// Issue #8: verify task field edits and status changes through the browser UI.

import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const LEAD_EMAIL = 'lead@example.test';
const MEMBER_EMAIL = 'member@example.test';
const PROJECT_ID = 'project-alpha';
const ORIGINAL_TITLE = 'Draft the API error envelope contract';
const UPDATED_TITLE = 'Document the API error envelope';
const MOCK_MODE = process.env.NEXT_PUBLIC_API_MODE === 'mock';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

const column = (page, status) => page.getByRole('region', { name: new RegExp(`^${status}`) });
const taskCard = (page, status, title) => column(page, status).getByRole('button', { name: new RegExp(title) });

async function savedStatus(page, title, status, change) {
  if (!MOCK_MODE) {
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/tasks\/[^/]+\/status$/.test(r.url()));
    await change();
    expect((await response).ok()).toBe(true);
    return;
  }

  await change();
  await expect
    .poll(() => page.evaluate((t) => JSON.parse(localStorage.getItem('taskline.mockdb.v1') || '{"tasks":[]}').tasks.find((task) => task.title === t)?.status, title))
    .toBe(status);
}

test('TC-Task-02/03 authorized lead edits task fields and members change status', async ({ page }) => {
  await signIn(page, LEAD_EMAIL);
  await page.goto(`/projects/${PROJECT_ID}`);

  await taskCard(page, 'To Do', ORIGINAL_TITLE).click();
  await expect(page.getByRole('heading', { name: ORIGINAL_TITLE })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Title' }).fill('   ');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Give the task a title.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Title' }).fill(UPDATED_TITLE);
  await page.getByRole('textbox', { name: 'Description' }).fill('Updated through the task detail form.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: UPDATED_TITLE })).toBeVisible();
  await expect(page.getByText('Updated through the task detail form.')).toBeVisible();

  await savedStatus(page, UPDATED_TITLE, 'In Progress', () => page.locator('#sheet-status').selectOption('In Progress'));
  await expect(page.locator('#sheet-status')).toHaveValue('In Progress');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(taskCard(page, 'In Progress', UPDATED_TITLE)).toBeVisible();
  await expect(taskCard(page, 'To Do', ORIGINAL_TITLE)).toHaveCount(0);

  await page.reload();
  await taskCard(page, 'In Progress', UPDATED_TITLE).click();
  await expect(page.getByRole('heading', { name: UPDATED_TITLE })).toBeVisible();
  await expect(page.locator('#sheet-status')).toHaveValue('In Progress');
  await expect(page.getByText('Updated through the task detail form.')).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();

  await signOut(page);
  await signIn(page, MEMBER_EMAIL);
  await page.goto(`/projects/${PROJECT_ID}`);
  await taskCard(page, 'In Progress', UPDATED_TITLE).click();
  await expect(page.getByRole('heading', { name: UPDATED_TITLE })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await savedStatus(page, UPDATED_TITLE, 'Done', () => page.locator('#sheet-status').selectOption('Done'));
  await expect(page.locator('#sheet-status')).toHaveValue('Done');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(taskCard(page, 'Done', UPDATED_TITLE)).toBeVisible();
  await page.reload();
  await taskCard(page, 'Done', UPDATED_TITLE).click();
  await expect(page.getByRole('heading', { name: UPDATED_TITLE })).toBeVisible();
  await expect(page.locator('#sheet-status')).toHaveValue('Done');
});

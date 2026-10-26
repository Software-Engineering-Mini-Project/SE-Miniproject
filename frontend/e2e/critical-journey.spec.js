// TC-E2E-01 Critical user journey (STP v1.0).
// Requirements: TM-F-001/002 (register, login), TM-F-020..023 (project, members, assign, board),
// TM-F-030 (assignment notification).
// Steps: register; log in as a lead; create a project; add the new user as a member;
// create a task assigned to them; move it on the board; reload; the assignee sees the notification.

import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const NEW_USER = { name: 'E2E Member', email: 'e2e.member@example.test' };
const LEAD_EMAIL = 'lead@example.test';
const PROJECT = 'E2E Launch';
const TASK = 'Write release notes';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

const column = (page, status) => page.getByRole('region', { name: new RegExp(`^${status}`) });

// Same switch the app is built with: mock mode unless NEXT_PUBLIC_API_MODE=http.
const MOCK_MODE = process.env.NEXT_PUBLIC_API_MODE !== 'http';

/**
 * The board moves a card optimistically, before the save finishes, so wait for the
 * saved status before reloading. Real API: the PATCH response. Mock: its localStorage DB.
 */
async function savedStatus(page, title, status, drop) {
  if (!MOCK_MODE) {
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/tasks\/[^/]+\/status$/.test(r.url()));
    await drop();
    expect((await response).ok()).toBe(true);
    return;
  }
  await drop();
  await expect
    .poll(() =>
      page.evaluate((t) => JSON.parse(localStorage.getItem('taskline.mockdb.v1') || '{"tasks":[]}').tasks.find((task) => task.title === t)?.status, title),
    )
    .toBe(status);
}

test('TC-E2E-01 critical journey: register, project, member, assign, move, reload, notification', async ({ page }) => {
  await test.step('TM-F-001 register a new account', async () => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(NEW_USER.name);
    await page.getByLabel('Email').fill(NEW_USER.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await signOut(page);
  });

  await test.step('TM-F-002 log in as a project lead', async () => {
    await signIn(page, LEAD_EMAIL);
  });

  await test.step('TM-F-020 create a project', async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill(PROJECT);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
    await expect(page.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
  });

  await test.step('TM-F-021 add the new user as a member', async () => {
    await page.getByRole('button', { name: 'Members: 1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Members' });
    await dialog.getByLabel('Add a registered user').fill(NEW_USER.email);
    await dialog.getByRole('button', { name: 'Add member' }).click();
    await expect(dialog.getByText(NEW_USER.email)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'Members: 2' })).toBeVisible();
  });

  await test.step('TM-F-010 / TM-F-022 create a task assigned to the member', async () => {
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel('Title').fill(TASK);
    await dialog.getByRole('checkbox', { name: NEW_USER.name }).check();
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialog).toBeHidden();
    await expect(column(page, 'To Do').getByRole('button', { name: new RegExp(TASK) })).toBeVisible();
  });

  await test.step('TM-F-012 / TM-F-023 move the card to In Progress (keyboard drag)', async () => {
    const card = column(page, 'To Do').getByRole('button', { name: new RegExp(TASK) });
    // Wait for each screen-reader announcement so every key lands after the board has reacted.
    await card.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText(`${TASK} is over To Do.`)).toBeAttached();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(`${TASK} is over In Progress.`)).toBeAttached();
    await savedStatus(page, TASK, 'In Progress', () => page.keyboard.press('Space'));
    await expect(column(page, 'In Progress').getByRole('button', { name: new RegExp(TASK) })).toBeVisible();
    await expect(column(page, 'To Do').getByRole('button', { name: new RegExp(TASK) })).toHaveCount(0);
  });

  await test.step('reload: board state is persisted', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: PROJECT })).toBeVisible();
    await expect(column(page, 'In Progress').getByRole('button', { name: new RegExp(TASK) })).toBeVisible();
  });

  await test.step('TM-F-030 the assignee sees the assignment notification', async () => {
    await signOut(page);
    await signIn(page, NEW_USER.email);
    await page.goto('/notifications');
    await expect(page.getByText(`You were assigned to "${TASK}".`)).toBeVisible();
    await page.goto('/projects');
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(PROJECT) })).toBeVisible();
  });
});

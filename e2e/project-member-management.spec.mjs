// Issue #9: project lifecycle, membership, assignment, board status and access boundaries.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const LEAD_EMAIL = 'lead@example.test';
const MEMBER_EMAIL = 'member@example.test';
const MEMBER_NAME = 'Synthetic Member';

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

test('TM-F-020..023 project members can be managed and assigned tasks stay within access boundaries', async ({ page }) => {
  const projectName = `Issue 9 project ${Date.now()}`;
  const taskTitle = `Issue 9 assigned task ${Date.now()}`;
  let projectUrl;

  await signIn(page, LEAD_EMAIL);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New project' });
  await createDialog.getByLabel('Name').fill(projectName);
  await createDialog.getByLabel('Description').fill('Synthetic project-management acceptance test.');
  await createDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  projectUrl = page.url();

  await page.getByRole('button', { name: 'Members: 1' }).click();
  const membersDialog = page.getByRole('dialog', { name: 'Members' });
  await membersDialog.getByLabel('Add a registered user').fill(MEMBER_EMAIL);
  await membersDialog.getByRole('button', { name: 'Add member' }).click();
  await expect(membersDialog.getByText(MEMBER_EMAIL)).toBeVisible();
  await membersDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Members: 2' })).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByLabel('Title').fill(taskTitle);
  await taskDialog.getByRole('checkbox', { name: MEMBER_NAME }).check();
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  const card = page.getByRole('region', { name: /^To Do/ }).getByRole('button', { name: new RegExp(taskTitle) });
  await expect(card).toBeVisible();

  await card.click();
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();
  await expect(page.getByRole('dialog').getByText(MEMBER_NAME)).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();

  await page.getByRole('button', { name: 'Members: 2' }).click();
  await page.getByRole('button', { name: `Remove ${MEMBER_NAME}` }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Members: 1' })).toBeVisible();
  await page.getByRole('region', { name: /^To Do/ }).getByRole('button', { name: new RegExp(taskTitle) }).click();
  await expect(page.getByText('Unassigned', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();

  await signOut(page);
  await signIn(page, MEMBER_EMAIL);
  await page.goto(projectUrl);
  await expect(page.getByText('You are not a member of this project')).toBeVisible();

  await signOut(page);
  await signIn(page, LEAD_EMAIL);
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Project options' }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete this project?' });
  await deleteDialog.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('link', { name: new RegExp(projectName) })).toHaveCount(0);
});

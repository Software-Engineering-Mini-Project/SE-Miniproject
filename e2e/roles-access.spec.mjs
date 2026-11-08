// Project roles and account deactivation, end to end. Read-only against the shared fixtures
// (the Viewer is seeded in Alpha); the deactivation test uses an account it registers itself.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function signIn(page, email, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

test('a Viewer sees the project read-only and can still comment', async ({ page }) => {
  await signIn(page, 'viewer@example.test');
  await page.goto('/projects/project-alpha');
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha Project' })).toBeVisible();
  await expect(page.getByTitle('Your role in this project')).toHaveText('Viewer');
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);

  const card = page.getByRole('region', { name: /^To Do/ }).getByRole('button').first();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('aria-roledescription', 'draggable task');

  await card.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('combobox', { name: 'Status' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(sheet.getByRole('textbox', { name: 'Add a comment' })).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();

  await page.getByRole('button', { name: 'Project options' }).click();
  await expect(page.getByRole('menuitem', { name: 'View members' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete project' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View members' }).click();
  const members = page.getByRole('dialog', { name: 'Members' });
  await expect(members.getByRole('button', { name: 'Add member' })).toHaveCount(0);
  await expect(members.getByRole('button', { name: 'Leave project' })).toBeVisible();
});

test('the project owner sees role controls, and the members dialog with the role guide is accessible', async ({ page }) => {
  await signIn(page, 'lead@example.test');
  await page.goto('/projects/project-alpha');
  await expect(page.getByTitle('Your role in this project')).toHaveText('Owner');
  await page.getByRole('button', { name: /^Members: / }).click();
  const members = page.getByRole('dialog', { name: 'Members' });
  await expect(members.getByLabel('Project role for Synthetic Viewer')).toHaveValue('Viewer');
  await expect(members.getByLabel('Role for the new member')).toBeVisible();
  await members.getByText('What can each role do?').click();
  await expect(members.getByRole('table', { name: 'Permissions by project role' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('an Admin deactivates an account, which then cannot sign in until reactivated', async ({ page }) => {
  const email = `deactivate-${Date.now()}@example.test`;
  const name = `Deactivation Check ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Invite code', { exact: true }).fill('ACMELABS');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await signOut(page);

  await signIn(page, 'admin@example.test');
  await page.goto('/admin/users');
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(email);
  await expect(page.getByRole('list', { name: 'Users' }).getByText(email)).toBeVisible();
  await page.getByRole('button', { name: `Deactivate ${name}` }).click();
  await page.getByRole('group', { name: `Confirm deactivating ${name}` }).getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('list', { name: 'Users' }).getByText('Deactivated')).toBeVisible();
  await signOut(page);

  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('This account has been deactivated. Contact a workspace admin.')).toBeVisible();

  await signIn(page, 'admin@example.test');
  await page.goto('/admin/users');
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(email);
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByRole('list', { name: 'Users' }).getByText('Deactivated')).toHaveCount(0);
  await signOut(page);
  await signIn(page, email);
});

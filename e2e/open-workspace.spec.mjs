// Open workspace, end to end: a brand-new account creates an open project from the
// getting-started screen, a teammate finds and joins it, and an admin limits who may create
// projects. Leaves the shared fixtures as it found them: the project is deleted and the
// organisation setting is restored (also after a failure, in HTTP mode).
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
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

async function setProjectCreation(page, value, message) {
  await page.goto('/admin/users');
  await page.getByRole('combobox', { name: 'Who can create projects' }).selectOption(value);
  await expect(page.getByText(message)).toBeVisible();
}

test.afterAll(async ({ request }) => {
  if (MOCK_MODE) return; // each browser context has its own mock database
  const login = await request.post('/api/auth/login', { data: { email: 'admin@example.test', password: PASSWORD } });
  const { token } = await login.json();
  await request.patch('/api/settings', { data: { projectCreation: 'everyone' }, headers: { Authorization: `Bearer ${token}` } });
});

test('a new account creates an open project from the getting-started screen, and a teammate joins it', async ({ page }) => {
  const stamp = Date.now();
  const projectName = `Open check ${stamp}`;
  await page.goto('/register');
  await page.getByLabel('Invite code', { exact: true }).fill('ACMELABS');
  await page.getByLabel('Full name').fill(`Newcomer ${stamp}`);
  await page.getByLabel('Email').fill(`newcomer-${stamp}@example.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('link', { name: 'Create or join a project' }).click();
  const start = page.getByRole('region', { name: 'Get started' });
  await expect(start.getByText(`newcomer-${stamp}@example.test`)).toBeVisible();
  await start.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill(projectName);
  await dialog.getByRole('radio', { name: /Open/ }).check();
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
  const projectUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  await expect(page.getByTitle('Your role in this project')).toHaveText('Owner');
  await expect(page.locator('.project-title-row .visibility-badge')).toHaveText('Open');

  await signOut(page);
  await signIn(page, 'outsider@example.test');
  await page.goto('/projects');
  const browse = page.getByRole('region', { name: 'Open projects' });
  await browse.getByRole('searchbox', { name: 'Search open projects' }).fill(`Open check ${stamp}`);
  await expect(browse.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(browse.getByText(`Owned by Newcomer ${stamp} · 1 member`)).toBeVisible();

  // A shared link to an open project offers to join instead of a dead end.
  await page.goto(projectUrl);
  await expect(page.getByRole('heading', { name: 'This project is open to everyone' })).toBeVisible();
  await page.getByRole('button', { name: 'Join project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  await expect(page.getByTitle('Your role in this project')).toHaveText('Member');

  // As a Member they add work straight away.
  const quickAdd = page.getByRole('textbox', { name: 'Quick add a task' });
  await quickAdd.fill('First contribution');
  await quickAdd.press('Enter');
  await expect(page.getByRole('region', { name: /^To Do/ }).getByRole('button', { name: /First contribution/ })).toBeVisible();

  await signOut(page);
  await signIn(page, 'admin@example.test');
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Project options' }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  await page.getByRole('dialog', { name: 'Delete this project?' }).getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('an admin limits project creation to leads, then opens it up again', async ({ page }) => {
  await signIn(page, 'admin@example.test');
  await setProjectCreation(page, 'leads', 'Only leads and admins can create projects now.');
  await signOut(page);

  await signIn(page, 'member@example.test');
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: /Alpha Project/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  await signOut(page);

  await signIn(page, 'admin@example.test');
  await setProjectCreation(page, 'everyone', 'Everyone can now create projects.');
  await signOut(page);
  await signIn(page, 'member@example.test');
  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
});

// Work-item keys (issue #73), end to end: the fixture tasks read as ALPHA-1.., a key search finds
// one task, the sheet shows the key, and an owner's own project gets a key, numbers its tasks and
// keeps old links working after the key changes. Leaves the shared fixtures as it found them: the
// project it creates is deleted at the end.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const toDo = (page) => page.getByRole('region', { name: /^To Do/ });

test('fixture tasks show their keys, and searching a key finds exactly that task', async ({ page }) => {
  await signIn(page, 'lead@example.test');
  await page.goto('/projects/project-alpha');
  await expect(page.locator('.project-title-row .project-key')).toHaveText(/ALPHA/);
  await expect(page.locator('.task-card .task-key').filter({ hasText: /^ALPHA-1$/ })).toBeVisible();

  await page.getByRole('search', { name: 'Filter tasks' }).getByLabel('Search tasks').fill('alpha-4');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('Build the project board columns');
  await page.locator('.task-card').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Copy link to ALPHA-4/ })).toBeVisible();
});

test('a new project gets a key, numbers its tasks, and old links survive a key change', async ({ page }) => {
  const stamp = Date.now();
  const name = `Keys check ${stamp}`;
  // Keys are letters only and must be free in the organisation: spell the timestamp in letters.
  const letters = String(stamp).slice(-6).replace(/\d/g, (digit) => 'ABCDEFGHIJ'[digit]);
  const FIRST = `K${letters}`;
  const SECOND = `R${letters}`;
  await signIn(page, 'lead@example.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('textbox', { name: 'Key' }).fill(FIRST);
  await expect(dialog.getByText(new RegExp(`Tasks will be numbered ${FIRST}-1`))).toBeVisible();
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;

  const quickAdd = page.getByRole('textbox', { name: 'Quick add a task' });
  await quickAdd.fill('First keyed task');
  await quickAdd.press('Enter');
  await expect(quickAdd).toHaveValue('');
  await quickAdd.fill('Second keyed task');
  await quickAdd.press('Enter');
  await expect(toDo(page).locator('.task-card').filter({ hasText: 'Second keyed task' }).locator('.task-key')).toHaveText(`${FIRST}-2`);

  // The owner renames the key; tasks follow, and the old key still opens the task.
  await page.getByRole('button', { name: 'Project options' }).click();
  await page.getByRole('menuitem', { name: 'Edit project' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit project' });
  await edit.getByRole('textbox', { name: 'Key' }).fill(SECOND);
  await expect(edit.getByText(new RegExp(`Links and searches that use ${FIRST} keep working`))).toBeVisible();
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.project-title-row .project-key')).toHaveText(new RegExp(SECOND));
  await expect(toDo(page).locator('.task-card').filter({ hasText: 'Second keyed task' }).locator('.task-key')).toHaveText(`${SECOND}-2`);

  await page.goto(`/browse/${FIRST}-1`);
  await expect(page).toHaveURL(new RegExp(`${projectPath}\\?task=`));
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'First keyed task' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: new RegExp(`Copy link to ${SECOND}-1`) })).toBeVisible();

  await page.goto(`/browse/${SECOND}-99`);
  await expect(page.getByRole('heading', { name: `No task has the key ${SECOND}-99` })).toBeVisible();

  // Clean up: delete the project (and its tasks).
  await page.goto(projectPath);
  await page.getByRole('button', { name: 'Project options' }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

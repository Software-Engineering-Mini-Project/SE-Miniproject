// Work-item keys (issue #73), end to end: the fixture tasks read as ALPHA-1.., a key search finds
// one task, the sheet shows the key, and an owner's own project gets a key, numbers its tasks and
// keeps old links working after the key changes; and (issue #74) types, points, labels and epics.
// Leaves the shared fixtures as it found them: what it creates is deleted at the end.
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

// Issue #74: types, story points, labels and epics. Adds one task to Alpha and deletes it again.
test('types, points, labels and epics: filter, quick add, move into an epic', async ({ page }) => {
  const title = `Drop zone flickers ${Date.now()}`;
  await signIn(page, 'lead@example.test');
  await page.goto('/projects/project-alpha');

  const epicCard = page.locator('.task-card[data-type="epic"]').filter({ hasText: 'Build the project board columns' });
  await expect(epicCard.getByRole('progressbar', { name: 'Epic progress' })).toBeVisible();
  await expect(page.locator('.task-card').filter({ hasText: 'Keyboard support for moving board cards' }).locator('.task-card-epic')).toHaveText(/Build the project board columns/);

  const filters = page.getByRole('search', { name: 'Filter tasks' });
  await filters.getByLabel('Type').selectOption('Bug');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('Export check');
  await filters.getByLabel('Type').selectOption('');
  await filters.getByLabel('Label').selectOption('accessibility');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('Keyboard support for moving board cards');
  await filters.getByRole('button', { name: /Clear/ }).click();

  const quickAdd = page.getByRole('textbox', { name: 'Quick add a task' });
  await quickAdd.fill(`${title} #bug #e2e 5pts`);
  await expect(page.locator('.quick-chip[data-kind="type"]')).toHaveText(/Bug/);
  await quickAdd.press('Enter');
  await expect(quickAdd).toHaveValue('');
  const card = toDo(page).locator('.task-card').filter({ hasText: title });
  await expect(card).toHaveAttribute('data-type', 'bug');
  await expect(card.getByText('5 story points')).toBeAttached();
  await expect(card.locator('.label-chip')).toHaveText('e2e');

  // Put the bug into the epic from the task sheet; the epic then lists it.
  await card.click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Edit' }).click();
  await sheet.getByLabel('Epic').selectOption({ label: 'ALPHA-4 Build the project board columns' });
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await sheet.getByRole('button', { name: /Build the project board columns/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Build the project board columns' })).toBeVisible();
  const items = page.getByRole('region', { name: 'Items in this epic' });
  await expect(items.getByRole('button', { name: new RegExp(title) })).toBeVisible();

  // Clean up: delete the bug.
  await items.getByRole('button', { name: new RegExp(title) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete task' }).click();
  await expect(page.locator('.task-card').filter({ hasText: title })).toHaveCount(0);
});

// Quick add, checklists and the Upcoming agenda, end to end. Leaves the shared fixtures as it
// found them: the quick-added task is deleted, the ticked fixture item is unticked again, and the
// member's checklist item is removed.
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
const MOCK_MODE = process.env.NEXT_PUBLIC_API_MODE === 'mock';

/** Ticks show at once (optimistic); wait until the change is actually saved before reloading. */
async function saved(page, taskTitle, itemText, done, change) {
  if (!MOCK_MODE) {
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/tasks\/[^/]+\/checklist\/[^/]+$/.test(r.url()));
    await change();
    expect((await response).ok()).toBe(true);
    return;
  }
  await change();
  await expect
    .poll(() => page.evaluate(([t, i]) => JSON.parse(localStorage.getItem('taskline.mockdb.v3') || '{"tasks":[]}')
      .tasks.find((task) => task.title === t)?.checklist?.find((item) => item.text === i)?.done, [taskTitle, itemText]))
    .toBe(done);
}

/** Removing is optimistic too; wait until the item is really gone before reloading. */
async function removed(page, taskTitle, itemText, change) {
  if (!MOCK_MODE) {
    const response = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/tasks\/[^/]+\/checklist\/[^/]+$/.test(r.url()));
    await change();
    expect((await response).ok()).toBe(true);
    return;
  }
  await change();
  await expect
    .poll(() => page.evaluate(([t, i]) => JSON.parse(localStorage.getItem('taskline.mockdb.v3') || '{"tasks":[]}')
      .tasks.find((task) => task.title === t)?.checklist?.some((item) => item.text === i), [taskTitle, itemText]))
    .toBe(false);
}

test('an owner quick-adds a task with details, builds its checklist, then deletes it', async ({ page }) => {
  const title = `Quick add check ${Date.now()}`;
  await signIn(page, 'lead@example.test');
  await page.goto('/projects/project-alpha');
  await expect(toDo(page).getByRole('button').first()).toBeVisible();

  const quickAdd = page.getByRole('textbox', { name: 'Quick add a task' });
  await quickAdd.fill(`${title} fri !high @member`);
  await expect(page.locator('.quick-chip').filter({ hasText: 'High priority' })).toBeVisible();
  await expect(page.locator('.quick-chip').filter({ hasText: 'Synthetic Member' })).toBeVisible();
  await quickAdd.press('Enter');
  await expect(quickAdd).toHaveValue('');

  const card = toDo(page).getByRole('button', { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card).toContainText('High');
  await card.click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: title })).toBeVisible();
  await expect(sheet.getByText('Synthetic Member', { exact: true })).toBeVisible();
  const addItem = sheet.getByRole('textbox', { name: 'Add a checklist item' });
  await addItem.fill('Write the steps');
  await addItem.press('Enter');
  await expect(sheet.getByText('0 of 1 done')).toBeVisible();
  await saved(page, title, 'Write the steps', true, () => sheet.getByText('Write the steps').click());
  await expect(sheet.getByText('1 of 1 done')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close task details' }).click();
  await expect(card).toContainText('1/1');

  // Saved, not just shown.
  await page.reload();
  await expect(toDo(page).getByRole('button', { name: new RegExp(title) })).toContainText('1/1');

  await toDo(page).getByRole('button', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete task' }).click();
  await expect(toDo(page).getByRole('button', { name: new RegExp(title) })).toHaveCount(0);
});

test('a member ticks and edits checklist items, and plans from Upcoming', async ({ page }) => {
  await signIn(page, 'member@example.test');
  await page.goto('/projects/project-alpha?task=task-002');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('2 of 4 done')).toBeVisible();

  // Members edit the list too: add an item, then remove it again.
  const step = `Member step ${Date.now()}`;
  const addItem = sheet.getByRole('textbox', { name: 'Add a checklist item' });
  await addItem.fill(step);
  await addItem.press('Enter');
  await expect(sheet.getByRole('checkbox', { name: step })).toBeVisible();
  await expect(sheet.getByText('2 of 5 done')).toBeVisible();
  await removed(page, 'Build the project board columns', step, () => sheet.getByRole('button', { name: `Remove "${step}"` }).click());
  await expect(sheet.getByText('2 of 4 done')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByText('2 of 4 done')).toBeVisible();

  const item = sheet.getByRole('checkbox', { name: 'Drag cards between columns' });
  await saved(page, 'Build the project board columns', 'Drag cards between columns', true, () => sheet.getByText('Drag cards between columns').click());
  await expect(item).toBeChecked();
  await expect(sheet.getByText('3 of 4 done')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Drag cards between columns' })).toBeChecked();
  await saved(page, 'Build the project board columns', 'Drag cards between columns', false, () => page.getByRole('dialog').getByText('Drag cards between columns').click());
  await expect(page.getByRole('dialog').getByText('2 of 4 done')).toBeVisible();

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Upcoming' }).click();
  const overdue = page.getByRole('region', { name: /^Overdue/ });
  await expect(overdue.getByRole('button', { name: /Draft the API error envelope contract/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
});

test('a viewer gets neither quick add nor checklist controls', async ({ page }) => {
  await signIn(page, 'viewer@example.test');
  await page.goto('/projects/project-alpha?task=task-002');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('checkbox', { name: 'Lay out the three status columns' })).toBeDisabled();
  await expect(sheet.getByRole('textbox', { name: 'Add a checklist item' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close task details' }).click();
  await expect(page.getByRole('textbox', { name: 'Quick add a task' })).toHaveCount(0);
});

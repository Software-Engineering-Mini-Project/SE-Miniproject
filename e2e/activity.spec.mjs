// Task activity history (issue #75), end to end: moving a task shows up in its Activity tab as a
// sentence naming who did it. Puts the task back afterwards.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';

test('the Activity tab shows who changed what, newest first', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/browse/ALPHA-1');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Draft the API error envelope contract' })).toBeVisible();
  await sheet.getByLabel('Status').selectOption('In Progress');

  await sheet.getByRole('tab', { name: 'Activity' }).click();
  const entries = sheet.getByRole('list', { name: 'Activity, newest first' }).getByRole('listitem');
  await expect(entries.first()).toContainText(/moved ALPHA-1 from To Do to In Progress · just now/);
  await expect(entries.last()).toContainText('created ALPHA-1');

  // Keyboard: arrows move between the tabs.
  await sheet.getByRole('tab', { name: 'Activity' }).press('ArrowLeft');
  await expect(sheet.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true');

  await sheet.getByLabel('Status').selectOption('To Do');
  await sheet.getByRole('tab', { name: 'Activity' }).click();
  await expect(entries.first()).toContainText(/moved ALPHA-1 from In Progress to To Do/);
});

// Issue #10: task search, filtering, dashboard summaries and safe CSV export.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const LEAD_EMAIL = 'lead@example.test';

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(LEAD_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('TM-F-040..042 search, filters, dashboard summaries and CSV export use authorized project data', async ({ page }) => {
  await signIn(page);

  // The stat tiles; "Overdue" is also a label in the due-date chart further down.
  const stats = page.locator('dl.stats');
  await expect(stats.getByText('Assigned to you', { exact: true })).toBeVisible();
  await expect(stats.getByText('Due in 7 days', { exact: true })).toBeVisible();
  await expect(stats.getByText('Overdue', { exact: true })).toBeVisible();
  await expect(stats.getByText('Completed', { exact: true })).toBeVisible();
  const alphaSummary = page.getByRole('link', { name: /Alpha Project/ });
  await expect(alphaSummary.getByText('2/7 done')).toBeVisible();

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Everyone' }).click();
  await page.getByRole('search', { name: 'Filter tasks' }).getByLabel('Search tasks').fill('login form');
  await expect(page.getByRole('button', { name: /Connect the login form to the auth API/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Draft the API error envelope contract/ })).toHaveCount(0);
  await page.getByLabel('Status').selectOption('In Progress');
  await page.getByLabel('Priority').selectOption('High');
  await expect(page.getByRole('button', { name: /Connect the login form to the auth API/ })).toBeVisible();
  await expect(page.getByText('1 task', { exact: true })).toBeVisible();

  await page.goto('/projects/project-alpha');
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadReady;
  assert.equal(download.suggestedFilename(), 'alpha-project-tasks.csv');
  const downloadPath = await download.path();
  assert.ok(downloadPath, 'CSV download should be available to inspect');
  const bytes = await readFile(downloadPath);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV starts with a UTF-8 BOM for Excel');
  const csv = bytes.subarray(3).toString('utf8');
  assert.match(csv, /^id,key,title,status,priority,dueDate,assignees,createdAt,updatedAt\r\n/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test"",""Export check""\)"/);
  assert.match(csv, /\r\n/);
});

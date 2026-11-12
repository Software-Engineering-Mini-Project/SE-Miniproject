// Backlog and sprints (issue #76), end to end: the Backlog view, planning a task into the active
// sprint (menu and keyboard drag), the one-active-sprint rule, the board's sprint switch, and an
// accessibility scan. Leaves the seed as it found it (the task back in the backlog, no new sprint).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const keysIn = (region) => region.getByRole('listitem').locator('.task-key');

test('plan work in the backlog and run one sprint at a time', async ({ page }) => {
  await signIn(page);
  await page.goto('/projects/project-alpha');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Backlog' }).click();

  const sprint = page.getByRole('region', { name: /^ALPHA Sprint 2/ });
  const backlog = page.getByRole('region', { name: /^Backlog/ });
  await expect(sprint.getByText('Active', { exact: true })).toBeVisible();
  await expect(keysIn(sprint)).toHaveText(['ALPHA-5', 'ALPHA-6', 'ALPHA-1']);
  await expect(keysIn(backlog)).toHaveText(['ALPHA-7', 'ALPHA-4']);
  await page.locator('.sprint-record summary', { hasText: 'ALPHA Sprint 1' }).click();
  await expect(page.getByRole('list', { name: 'Finished in ALPHA Sprint 1' }).getByRole('listitem')).toHaveCount(2);

  // No horizontal scrolling and no axe violations on the Backlog view.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  // Plan ALPHA-7 into the sprint from its menu: it joins the bottom.
  await page.getByRole('button', { name: 'Plan ALPHA-7' }).click();
  await page.getByRole('menuitem', { name: 'Move to ALPHA Sprint 2' }).click();
  await expect(keysIn(sprint)).toHaveText(['ALPHA-5', 'ALPHA-6', 'ALPHA-1', 'ALPHA-7']);
  await expect(keysIn(backlog)).toHaveText(['ALPHA-4']);

  // Keyboard drag: pick it up, move it up one place, drop it. Each key waits for the
  // screen-reader announcement, so it lands after the list has reacted.
  await sprint.getByRole('button', { name: 'Reorder ALPHA-7' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('ALPHA-7 is in ALPHA Sprint 2, at ALPHA-7.')).toBeAttached();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('ALPHA-7 is in ALPHA Sprint 2, at ALPHA-1.')).toBeAttached();
  await page.keyboard.press('Space');
  await expect(keysIn(sprint)).toHaveText(['ALPHA-5', 'ALPHA-6', 'ALPHA-7', 'ALPHA-1']);

  // A second sprint can be planned but not started while ALPHA Sprint 2 runs.
  await backlog.getByRole('button', { name: 'Create sprint' }).click();
  const form = page.getByRole('dialog', { name: 'New sprint' });
  await expect(form.getByLabel('Name')).toHaveValue('ALPHA Sprint 3');
  await form.getByLabel('Sprint goal').fill('Polish the backlog');
  await form.getByRole('button', { name: 'Create sprint' }).click();
  const next = page.getByRole('region', { name: /^ALPHA Sprint 3/ });
  await expect(next.getByText('Planned', { exact: true })).toBeVisible();
  await next.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByText('Complete "ALPHA Sprint 2" before starting another sprint. A project runs one sprint at a time.')).toBeVisible();

  // The board can show only the active sprint.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('heading', { name: 'Build the project board columns' })).toBeVisible();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Active sprint' }).click();
  await expect(page.getByRole('heading', { name: 'Build the project board columns' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connect the login form to the auth API' })).toBeVisible();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All tasks' }).click();

  // Put things back: ALPHA-7 to the top of the backlog, and delete the planned sprint.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Backlog' }).click();
  await page.getByRole('button', { name: 'Plan ALPHA-7' }).click();
  await page.getByRole('menuitem', { name: 'Move to the backlog' }).click();
  await expect(keysIn(backlog)).toHaveText(['ALPHA-7', 'ALPHA-4']);
  await next.getByRole('button', { name: 'ALPHA Sprint 3 options' }).click();
  await page.getByRole('menuitem', { name: 'Delete sprint' }).click();
  await page.getByRole('dialog', { name: 'Delete this sprint?' }).getByRole('button', { name: 'Delete sprint' }).click();
  await expect(page.getByRole('region', { name: /^ALPHA Sprint 3/ })).toHaveCount(0);

  // The move shows in the task's history.
  await page.goto('/browse/ALPHA-7');
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Activity' }).click();
  await expect(sheet.getByRole('list', { name: 'Activity, newest first' }).getByRole('listitem').first()).toContainText('moved ALPHA-7 out of "ALPHA Sprint 2" to the backlog');
});

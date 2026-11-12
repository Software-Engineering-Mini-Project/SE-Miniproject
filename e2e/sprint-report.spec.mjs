// Sprint report, burndown and velocity (issue #77), end to end, plus the dark theme: the report
// reads from the keyboard and as a table, and the main pages pass axe in both colour schemes.
// Read-only: it changes nothing in the seed.
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

async function expectNoViolations(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const chooseView = (page, name) => page.getByRole('group', { name: 'View' }).getByRole('button', { name }).click();

test('the sprint report shows the burndown, reads by keyboard and as a table, and tracks velocity', async ({ page }) => {
  await signIn(page);
  await page.goto('/projects/project-alpha');
  await chooseView(page, 'Insights');

  const report = page.getByRole('region', { name: /Sprint report/ });
  await expect(report).toBeVisible();
  await expect(report.getByRole('combobox', { name: 'Sprint' })).toHaveValue('sprint-alpha-2');
  const stats = report.locator('.sprint-stats');
  await expect(stats).toContainText('Committed10 points3 items');

  // The plot is one focusable group; arrows step through the days and a live readout says each one.
  const plot = report.getByRole('group', { name: /Burndown in points/ });
  await plot.focus();
  await page.keyboard.press('Home');
  await expect(report.getByText(/^\d{1,2} \w{3}: 10 points remaining, ideal 10$/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(report.getByText(/^\d{1,2} \w{3}: \d+ points remaining, ideal 9\.2$/)).toBeVisible();

  // The same numbers as a table.
  await report.getByRole('group', { name: 'Show the burndown as' }).getByRole('button', { name: 'Table' }).click();
  const table = report.getByRole('table', { name: 'Burndown by day' });
  await expect(table.getByRole('row')).toHaveCount(15);
  await expect(table.getByRole('row').nth(1)).toContainText('10');

  // The completed sprint: what was finished and what carried over into Sprint 2.
  await report.getByRole('combobox', { name: 'Sprint' }).selectOption('sprint-alpha-1');
  await expect(stats).toContainText('Completed2 points2 items');
  await expect(stats).toContainText('Carried over');

  // Velocity across completed sprints, and the forecast it feeds.
  await expect(page.getByRole('listitem', { name: 'ALPHA Sprint 1: 2 of 4 points committed completed' })).toBeVisible();
  await expect(page.getByText(/By velocity: about \d+ sprints?/)).toBeVisible();

  await expectNoViolations(page, 'insights');
});

test('the dark theme follows the system setting and keeps every page accessible', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(17, 18, 20)');
  await expectNoViolations(page, 'dashboard');

  await page.goto('/projects/project-alpha');
  for (const view of ['Board', 'List', 'Backlog', 'Insights']) {
    await chooseView(page, view);
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true');
    await expectNoViolations(page, view.toLowerCase());
  }

  // The task sheet opens over the dark page and stays readable too.
  await page.goto('/browse/ALPHA-5');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page, 'task sheet');
});

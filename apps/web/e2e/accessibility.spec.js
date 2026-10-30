// TC-UX-01 Responsive and accessible core flow (STP v1.0), automated part. Requirement: TM-NF-004.
// axe WCAG 2.1 A/AA scan and a horizontal-overflow check on the core pages at mobile, tablet and
// desktop widths, plus keyboard checks. Supports, but does not replace, the manual checklist.
// Uses the seeded demo accounts, so it runs in both mock and http mode (seed the API first).

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const LEAD_EMAIL = 'lead@example.test';
const PROJECT_PATH = '/projects/project-alpha';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

const APP_PAGES = ['/dashboard', '/projects', PROJECT_PATH, '/tasks', '/notifications', '/profile'];

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(LEAD_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Wait for the page heading and for loading skeletons and entrance animations to finish. */
async function settle(page) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  // The auth title fades in word by word; scanning mid-fade reports false contrast failures.
  await expect
    .poll(() => page.locator('.auth-showcase-title [aria-hidden="true"]').evaluateAll((pieces) => pieces.every((p) => getComputedStyle(p).opacity === '1')))
    .toBe(true);
}

/** Measure overflow before axe runs: axe scrolls containers while it scans. */
async function expectAccessible(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: page scrolls horizontally`).toBeLessThanOrEqual(0);

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label}: axe violations`).toEqual([]);
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`TC-UX-01 ${name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('sign-in and registration pages', async ({ page }) => {
      for (const path of ['/login', '/register']) {
        await page.goto(path);
        await settle(page);
        await expectAccessible(page, path);
      }
    });

    test('core app pages and the task form', async ({ page }) => {
      await signIn(page);
      for (const path of APP_PAGES) {
        await page.goto(path);
        await settle(page);
        // Scan the loaded board, not its placeholders.
        if (path === PROJECT_PATH) await expect(page.getByRole('region', { name: /^To Do/ }).getByRole('button').first()).toBeVisible();
        await expectAccessible(page, path);
      }

      await page.goto(PROJECT_PATH);
      await settle(page);
      await page.getByRole('button', { name: 'New task' }).click();
      await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
      await expectAccessible(page, 'New task dialog');
    });
  });
}

test.describe('TC-UX-01 keyboard', () => {
  test('desktop: the first Tab reaches the skip link, which moves focus to the main content', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page);
    await settle(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('mobile: the navigation drawer opens, navigates and closes with the keyboard only', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await signIn(page);
    await settle(page);
    await page.getByRole('button', { name: 'Open navigation' }).focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(drawer).toBeVisible();
    const projects = drawer.getByRole('link', { name: 'Projects' });
    await projects.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects$/);
    await expect(drawer).toBeHidden();
  });
});

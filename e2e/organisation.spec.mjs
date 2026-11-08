// Organisations, end to end: someone starts one and gets its invite code, a teammate joins with it
// on the same sign-in page, admins and members see the organisation page differently, rotating the
// code ends the old one, and another organisation's projects are out of reach.
// Each run registers a new organisation and two accounts; the demo organisations are left as found.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';

// The real API allows 5 registrations per client IP per 10 minutes, and the other specs share the
// default address. This spec registers three accounts, so it presents its own (the API trusts
// X-Forwarded-For from loopback); a random address keeps repeat runs from sharing a window.
test.use({ extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${1 + Math.floor(Math.random() * 250)}` } });

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

test('an organisation is started, joined with its invite code, and the code can be replaced', async ({ page }) => {
  const stamp = Date.now();
  const orgName = `Globex ${stamp}`;
  const founderEmail = `founder-${stamp}@example.test`;

  // Start an organisation: the founder becomes its admin and lands on its page with the code.
  await page.goto('/register');
  await page.getByRole('radio', { name: /Create an organisation/ }).check();
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Full name').fill(`Founder ${stamp}`);
  await page.getByLabel('Email').fill(founderEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/organisation$/);
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  const code = (await page.getByLabel('Invite code', { exact: true }).innerText()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  await expect(page.getByRole('link', { name: /Manage people/ })).toBeVisible();
  await expect(page.getByRole('main').getByText('No projects yet')).toBeVisible();
  // A brand-new organisation has none of the demo organisation's work.
  await page.goto('/projects');
  await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible();
  await expect(page.getByText('Alpha Project')).toHaveCount(0);
  await signOut(page);

  // A teammate joins on the same page, typing the code in any case.
  const memberEmail = `teammate-${stamp}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Invite code', { exact: true }).fill(code.toLowerCase());
  await page.getByLabel('Full name').fill(`Teammate ${stamp}`);
  await page.getByLabel('Email').fill(memberEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.sidebar-org').first()).toHaveText(orgName);
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await expect(page.getByText('Invite people')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Manage people/ })).toHaveCount(0);
  await signOut(page);

  // The admin replaces the code; the old one stops working.
  await signIn(page, founderEmail);
  await page.goto('/organisation');
  await page.getByRole('button', { name: 'Create a new code' }).click();
  await page.getByRole('button', { name: 'Replace code' }).click();
  await expect(page.getByText('New invite code created. The old one no longer works.')).toBeVisible();
  await expect(page.getByLabel('Invite code', { exact: true })).not.toHaveText(code);
  await signOut(page);

  await page.goto('/register');
  await page.getByLabel('Invite code', { exact: true }).fill(code);
  await page.getByLabel('Full name').fill('Latecomer');
  await page.getByLabel('Email').fill(`late-${stamp}@example.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/invite code is not recognised/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test('the organisation page: admins see every project and the code, members only theirs and the open ones', async ({ page }) => {
  await signIn(page, 'admin@example.test');
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { level: 1, name: 'Acme Labs' })).toBeVisible();
  const projects = page.getByRole('region', { name: 'Projects' });
  await expect(projects.getByRole('link', { name: 'Alpha Project' })).toBeVisible();
  await expect(projects.getByRole('link', { name: 'Beta Project' })).toBeVisible();
  await expect(page.getByLabel('Invite code', { exact: true })).toHaveText('ACMEL-ABS');
  await signOut(page);

  await signIn(page, 'member@example.test');
  await page.goto('/organisation');
  const mine = page.getByRole('region', { name: 'Projects' });
  await expect(mine.getByRole('link', { name: 'Alpha Project' })).toBeVisible();
  await expect(mine.getByRole('link', { name: 'Beta Project' })).toHaveCount(0);
  await expect(page.getByLabel('Invite code', { exact: true })).toHaveCount(0);
  await mine.getByRole('link', { name: 'Alpha Project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha Project' })).toBeVisible();
});

test('another organisation is out of reach: its people see only their own projects', async ({ page }) => {
  await signIn(page, 'northwind-admin@example.test');
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { level: 1, name: 'Northwind Studio' })).toBeVisible();
  const projects = page.getByRole('region', { name: 'Projects' });
  await expect(projects.getByRole('link', { name: 'Northwind Roadmap' })).toBeVisible();
  await expect(projects.getByRole('link', { name: 'Alpha Project' })).toHaveCount(0);

  // A link to another organisation's project is a dead end, never a Join offer.
  await page.goto('/projects/project-alpha');
  await expect(page.getByRole('heading', { name: 'This project does not exist' })).toBeVisible();
  await signOut(page);

  // And the other way round: Acme's outsider cannot see Northwind's open project.
  await signIn(page, 'outsider@example.test');
  await page.goto('/projects');
  await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible();
  await expect(page.getByText(/Nothing to join right now/)).toBeVisible();
  await expect(page.getByText('Northwind Roadmap')).toHaveCount(0);
});

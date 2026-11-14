// Personal invitation links (issue #78), end to end: an Admin makes a link for one address, the
// invitee registers from it and joins, the link then stops working, and a revoked link never
// works. Each run starts its own organisation, so the demo organisations are left as found.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Password123!';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The real API allows 5 registrations per client IP per 10 minutes and other specs share the
// default address, so this spec (two registrations, one refused) presents its own.
test.use({ extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${1 + Math.floor(Math.random() * 250)}` } });

async function expectNoViolations(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

test('an admin invites one person by link; it works once, for them, and revoked links never work', async ({ page }) => {
  const stamp = Date.now();
  const orgName = `Initech ${stamp}`;
  const founderEmail = `founder-${stamp}@example.test`;
  const inviteeEmail = `invitee-${stamp}@example.test`;

  await page.goto('/register');
  await page.getByRole('radio', { name: /Create an organisation/ }).check();
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Full name').fill(`Founder ${stamp}`);
  await page.getByLabel('Email').fill(founderEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/organisation$/);

  // Make a link for the invitee, and one that gets revoked.
  const panel = page.getByRole('region', { name: 'Invite by link' });
  await panel.getByLabel('Email address').fill(inviteeEmail);
  await panel.getByRole('button', { name: 'Create link' }).click();
  const link = await panel.getByRole('textbox', { name: `Invitation link for ${inviteeEmail}` }).inputValue();
  expect(link).toMatch(/\/register\?invite=[A-Za-z0-9_-]{32}$/);
  await expect(panel.getByRole('status')).toContainText('shown only once');
  await expectNoViolations(page, 'organisation');

  await panel.getByLabel('Email address').fill(`withdrawn-${stamp}@example.test`);
  await panel.getByRole('button', { name: 'Create link' }).click();
  const withdrawn = await panel.getByRole('textbox', { name: /Invitation link for withdrawn-/ }).inputValue();
  await panel.getByRole('button', { name: `Revoke the link for withdrawn-${stamp}@example.test` }).click();
  await expect(page.getByText(`The link for withdrawn-${stamp}@example.test no longer works.`)).toBeVisible();
  const rows = panel.getByRole('list', { name: 'Invitations' }).getByRole('listitem');
  await expect(rows.filter({ hasText: `withdrawn-${stamp}` }).locator('.invitation-state')).toHaveText('Revoked');
  await expect(rows.filter({ hasText: inviteeEmail }).locator('.invitation-state')).toHaveText('Waiting');
  await signOut(page);

  // A revoked link explains itself and offers a way forward.
  await page.goto(withdrawn);
  await expect(page.getByRole('heading', { name: "This invitation can't be used" })).toBeVisible();
  await expect(page.locator('.form-alert')).toContainText('withdrawn');

  // The invitee's link names the organisation and fixes the address.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Join ${orgName}` })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(inviteeEmail);
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('radio')).toHaveCount(0);
  // The side panel's title fades in word by word; scanning mid-fade reports false contrast failures.
  await expect
    .poll(() => page.locator('.auth-showcase-title [aria-hidden="true"]').evaluateAll((pieces) => pieces.every((p) => getComputedStyle(p).opacity === '1')))
    .toBe(true);
  await expectNoViolations(page, 'register from a link');
  await page.getByLabel('Full name').fill(`Invitee ${stamp}`);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  // A member doesn't get the invitation panel.
  await expect(page.getByRole('region', { name: 'Invite by link' })).toHaveCount(0);
  await signOut(page);

  // Used once, it's done.
  await page.goto(link);
  await expect(page.locator('.form-alert')).toContainText('already been used');

  // The admin sees who joined.
  await page.goto('/login');
  await page.getByLabel('Email').fill(founderEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/organisation');
  await expect(page.getByRole('region', { name: 'Invite by link' }).getByRole('listitem').filter({ hasText: inviteeEmail }).locator('.invitation-state')).toHaveText('Joined');
});

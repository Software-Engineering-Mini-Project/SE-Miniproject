// Issue #7: exercise the authentication and profile workflows through the browser UI.
// The API integration suite separately verifies password hashing, JWT expiry, and token authorization.

import { expect, test } from '@playwright/test';

const OLD_PASSWORD = 'E2eAuth123!';
const NEW_PASSWORD = 'E2eChanged456';
const EMAIL = 'e2e.auth@example.test';

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

test('TC-AUTH-01/02/03 registration, login, and profile changes persist', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('Use 8+ characters with a letter and a number.')).toBeVisible();

  await page.getByLabel('Full name').fill('Synthetic E2E User');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await signOut(page);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill('WrongPassword123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.', { exact: true })).toBeVisible();

  await page.getByRole('textbox', { name: 'Password' }).fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/profile');
  await page.getByLabel('Display name').fill('Updated E2E User');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Name updated.')).toBeVisible();
  await expect(page.getByText('Updated E2E User').first()).toBeVisible();

  await page.getByLabel('Current password').fill(OLD_PASSWORD);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Use it next time you sign in.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText('Updated E2E User').first()).toBeVisible();

  await signOut(page);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});

test('TC-AUTH-02 protects profile routes and returns the user after sign-in', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
  await page.getByLabel('Email').fill('lead@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});

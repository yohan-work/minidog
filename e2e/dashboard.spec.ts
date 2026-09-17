import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'e2e-password-long';
const TRACE = '5b8efff798038103d269b633813fc60c';

test.describe.configure({ mode: 'serial' });

/** Sidebar links only: pages also link to each other ("Open in Logs"), which would match twice. */
function navLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name, exact: true });
}

/**
 * The stack outlives a retry, so the password may already be set: take whichever
 * form the login page shows once auth status has loaded.
 */
async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  const heading = page.getByRole('heading', { name: /^(Set a password|Sign in)$/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await page.locator('#password').fill(PASSWORD);
  if ((await heading.textContent()) === 'Set a password') {
    await page.locator('#confirm').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set password and continue' }).click();
  } else {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

test('signs in and follows a seeded service → trace → log', async ({ page }) => {
  await signIn(page);
  await expect(navLink(page, 'Services')).toBeVisible();

  await navLink(page, 'Services').click();
  await expect(page).toHaveURL(/\/services/);
  await expect(page.getByRole('link', { name: 'api' }).first()).toBeVisible({ timeout: 30_000 });

  await navLink(page, 'Traces').click();
  await expect(page).toHaveURL(/\/traces/);
  await expect(page.getByText('GET /health').first()).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('link', { name: /GET \/health/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/traces/${TRACE}`));
  await expect(page.getByText('GET /health').first()).toBeVisible();

  await navLink(page, 'Logs').click();
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText('e2e health check ok').first()).toBeVisible({ timeout: 30_000 });
});

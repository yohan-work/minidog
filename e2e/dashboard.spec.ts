import { expect, test } from '@playwright/test';

const PASSWORD = 'e2e-password-long';
const TRACE = '5b8efff798038103d269b633813fc60c';

test.describe.configure({ mode: 'serial' });

test('sets a password, signs in, and follows a seeded service → trace → log', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set password and continue' }).click();
  await expect(page).toHaveURL(/\/($|\?)/);
  await expect(page.getByRole('link', { name: 'Services' })).toBeVisible();

  await page.getByRole('link', { name: 'Services' }).click();
  await expect(page).toHaveURL(/\/services/);
  await expect(page.getByRole('link', { name: 'api' }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: 'Traces' }).click();
  await expect(page).toHaveURL(/\/traces/);
  await expect(page.getByText('GET /health').first()).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('link', { name: /GET \/health/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/traces/${TRACE}`));
  await expect(page.getByText('GET /health').first()).toBeVisible();

  await page.getByRole('link', { name: 'Logs' }).click();
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText('e2e health check ok').first()).toBeVisible({ timeout: 30_000 });
});

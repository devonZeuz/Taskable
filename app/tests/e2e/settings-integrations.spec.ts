import { expect, test } from '@playwright/test';

test('integration credentials inputs are interactive inside settings dialog', async ({ page }) => {
  await page.goto('/');

  await page
    .getByRole('button', { name: /Settings/i })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  const integrationsNav = page.getByRole('button', { name: 'Integrations' }).first();
  await integrationsNav.click();

  const emailInput = page.locator('#cloud-email');
  const passwordInput = page.locator('#cloud-password');
  const hasCloudAuthInputs = (await emailInput.count()) > 0 && (await passwordInput.count()) > 0;
  test.skip(!hasCloudAuthInputs, 'Cloud auth controls are disabled for this run.');

  await emailInput.click();
  await emailInput.fill('qa@example.com');
  await expect(emailInput).toHaveValue('qa@example.com');

  await passwordInput.click();
  await passwordInput.fill('Password123!');
  await expect(passwordInput).toHaveValue('Password123!');
});

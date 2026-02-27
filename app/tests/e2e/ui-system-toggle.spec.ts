import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('ui system v1 is enabled by default', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner');

  const appShell = page.locator('[data-ui-system="v1"]').first();
  await expect(appShell).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ui-system', 'v1');
});

test('ui system can be rolled back with single runtime flag', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner?uiSystemV1=0');

  const legacyShell = page.locator('[data-ui-system="legacy"]').first();
  await expect(legacyShell).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ui-system', 'legacy');
});

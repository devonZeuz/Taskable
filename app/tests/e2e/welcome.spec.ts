import { expect, test } from '@playwright/test';

test('welcome screen renders calm hero and calendar preview', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await expect(page.getByTestId('welcome-planner-preview')).toBeVisible();
  await expect(page.getByTestId('welcome-continue-local')).toBeVisible();
  await expect(page.getByTestId('welcome-sign-in')).toBeVisible();
  await expect(page.getByTestId('welcome-sign-up')).toBeVisible();
  await expect(page.getByText('Execution Planner')).toHaveCount(0);
});

test('welcome actions route correctly', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await page.getByTestId('welcome-continue-local').click();
  await expect(page).toHaveURL(/\/planner$/);

  await page.goto('/welcome');
  await page.getByTestId('welcome-sign-in').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/welcome');
  await page.getByTestId('welcome-sign-up').click();
  await expect(page).toHaveURL(/\/signup$/);
});

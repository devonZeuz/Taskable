import { expect, test } from '@playwright/test';

test('root route redirects to welcome screen', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await expect(page.getByTestId('welcome-continue-local')).toBeVisible();
  await expect(page.getByTestId('welcome-sign-in')).toBeVisible();
  await expect(page.getByTestId('welcome-sign-up')).toBeVisible();
});

test('welcome CTAs route to local planner and cloud auth', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await page.getByTestId('welcome-continue-local').click();
  await expect(page).toHaveURL(/\/planner$/);

  await page.goto('/welcome');
  await page.getByTestId('welcome-sign-in').click();
  await expect(page).toHaveURL(/\/login$/);
});

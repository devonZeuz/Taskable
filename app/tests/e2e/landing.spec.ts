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

test('welcome trust and demo links open public product surfaces', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');

  await page.getByTestId('welcome-demo-link').click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByTestId('demo-page')).toBeVisible();

  await page.goto('/welcome');
  await page.getByTestId('welcome-security-link').click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByTestId('security-page')).toBeVisible();

  await page.goto('/welcome');
  await page.getByTestId('welcome-support-link').click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByTestId('support-page')).toBeVisible();
});

import { expect, test } from '@playwright/test';

test('fresh browser lands on welcome instead of planner', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
});

test('continue locally enters planner with empty state', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await page.getByTestId('welcome-continue-local').click();

  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByTestId('add-task-trigger').first()).toBeVisible();
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(0);
});

test('signup flow is reachable from welcome', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await page.getByTestId('welcome-sign-up').click();

  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByTestId('auth-signup-form')).toBeVisible();
  await expect(page.locator('#signup-email')).toBeVisible();
  await expect(page.locator('#signup-password')).toBeVisible();
});

test('cloud runtime API failure shows branded app error UI', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'cloud');
    window.localStorage.setItem('taskable:cloud-token', 'e2e-invalid-token');
  });

  await page.route('**/api/me*', async (route) => {
    await route.abort('failed');
  });

  await page.goto('/planner');
  await expect(page.getByTestId('route-error-boundary')).toBeVisible();
  await expect(page.getByTestId('route-error-diagnostics')).toBeVisible();
});

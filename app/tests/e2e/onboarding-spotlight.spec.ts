import { expect, test } from '@playwright/test';

test('spotlight onboarding highlights live planner controls and opens settings', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await page.getByTestId('welcome-continue-local').click();

  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'inbox');

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'create-task-paths');
  await expect(page.getByTestId('add-task-trigger').first()).toBeVisible();
  const quickAddButton = page.locator('[data-onboarding-quick-add="button"]').first();
  await expect(quickAddButton).toBeVisible();
  await expect
    .poll(async () => quickAddButton.evaluate((element) => getComputedStyle(element).opacity))
    .not.toBe('0');

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'task-dialog');
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await expect(page.getByTestId('task-type-helper')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'task-hud');
  await expect(page.getByTestId('task-quick-actions-hub')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'capacity');
  await expect(page.getByTestId('capacity-bar-panel')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'daily-planning');
  await expect(page.getByTestId('daily-planning-panel')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-next').click();
  await expect(page.locator('html')).toHaveAttribute('data-onboarding-step', 'settings-general');
  await expect(page.getByTestId('settings-drawer')).toBeVisible();
  await expect(page.getByTestId('ui-density-control')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-finish').click();
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeHidden();
  await expect(page.getByTestId('settings-drawer')).toBeHidden();
});

import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('settings dialog stays open after a direct trigger click', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');

  const tutorialModal = page.getByTestId('onboarding-tutorial-modal');
  if (await tutorialModal.isVisible().catch(() => false)) {
    await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
    await expect(tutorialModal).toBeHidden();
  }

  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const settingsTrigger = page.locator('[data-testid="toprail-settings"]').first();
  await expect(settingsTrigger).toBeVisible();
  await settingsTrigger.click({ force: true });
  await expect(settingsDialog).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(settingsDialog).toBeVisible();
});

test('settings dialog stays open while a task is running', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');

  const tutorialModal = page.getByTestId('onboarding-tutorial-modal');
  if (await tutorialModal.isVisible().catch(() => false)) {
    await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
    await expect(tutorialModal).toBeHidden();
  }

  await page.getByTestId('task-action-strip-3').click();

  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const settingsTrigger = page.locator('[data-testid="toprail-settings"]').first();
  await expect(settingsTrigger).toBeVisible();
  await settingsTrigger.click({ force: true });
  await expect(settingsDialog).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(settingsDialog).toBeVisible();
});

test('integration credentials inputs are interactive inside settings dialog', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');
  const tutorialModal = page.getByTestId('onboarding-tutorial-modal');
  if (await tutorialModal.isVisible().catch(() => false)) {
    await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
    await expect(tutorialModal).toBeHidden();
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const settingsTrigger = page.getByRole('button', { name: /Settings/i }).first();
    if (await settingsTrigger.isVisible().catch(() => false)) {
      break;
    }

    const openFullButton = page.getByRole('button', { name: /Open Full/i });
    if (await openFullButton.isVisible().catch(() => false)) {
      await openFullButton.click({ force: true });
      await expect(page).toHaveURL(/\/planner(?:\?.*)?$/);
      continue;
    }

    await page.goto('/planner');
  }

  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const settingsTrigger = page.getByRole('button', { name: /Settings/i }).first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await settingsDialog.isVisible().catch(() => false)) break;

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('taskable:open-settings', {
          detail: { section: 'integrations' },
        })
      );
    });

    if (await settingsTrigger.isVisible().catch(() => false)) {
      await settingsTrigger.click({ force: true });
    }

    await page.waitForTimeout(150);
  }

  await expect(settingsDialog).toBeVisible();

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

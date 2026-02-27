import { expect, test, type Page } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function openSettingsSection(page: Page, section: 'general' = 'general') {
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const settingsTrigger = page.getByRole('button', { name: /Settings/i }).first();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await settingsDialog.isVisible().catch(() => false)) {
      return;
    }

    await page.evaluate((requestedSection) => {
      window.dispatchEvent(
        new CustomEvent('taskable:open-settings', {
          detail: { section: requestedSection },
        })
      );
    }, section);

    if (await settingsTrigger.isVisible().catch(() => false)) {
      await settingsTrigger.click({ force: true }).catch(() => undefined);
    }

    await page.waitForTimeout(140);
  }

  await expect(settingsDialog).toBeVisible();
}

test('execution mode toggle persists and shows planner HUD indicator', async ({ page }) => {
  await bootstrapLocalMode(page, { clearStorage: false });
  await page.addInitScript(() => {
    window.localStorage.setItem('taskable:execution-mode-v1', '1');
  });

  await page.goto('/planner?executionModeV1=1');
  await expect(page.getByTestId('execution-mode-indicator')).toHaveCount(0);

  await openSettingsSection(page);
  const executionToggle = page.getByTestId('execution-mode-toggle');
  await expect(executionToggle).toBeVisible();

  if ((await executionToggle.getAttribute('aria-checked')) !== 'true') {
    await executionToggle.click({ force: true });
  }
  await expect(executionToggle).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(async () =>
      page.evaluate(() => window.localStorage.getItem('taskable:execution-mode:local'))
    )
    .toMatch(/^(1|true)$/);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('execution-mode-indicator')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('execution-mode-indicator')).toBeVisible();
});

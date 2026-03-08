import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test.beforeEach(async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
});

test('shows branded recovery UI when lazy route chunk fails', async ({ page }) => {
  let abortNextChunk = false;
  let abortedChunkUrl = '';

  await page.route('**/assets/*.js*', async (route) => {
    const url = route.request().url();
    const isTargetTeamChunk = /\/assets\/TeamView-[^/]+\.js/.test(url);

    if (abortNextChunk && isTargetTeamChunk) {
      abortNextChunk = false;
      abortedChunkUrl = url;
      await route.abort('failed');
      return;
    }

    await route.continue();
  });

  await page.goto('/planner');
  abortNextChunk = true;
  await page.goto('/team');

  await expect(page.getByTestId('route-error-boundary')).toBeVisible();
  await expect(page.getByTestId('route-error-retry')).toBeVisible();
  await expect(page.getByTestId('route-error-reload')).toBeVisible();
  await expect(page.getByTestId('route-error-home')).toBeVisible();
  await expect(page.getByTestId('route-error-diagnostics')).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  expect(abortedChunkUrl).not.toBe('');
});

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test('shows branded recovery UI when lazy route chunk fails', async ({ page }) => {
  let abortNextChunk = false;
  let abortedChunkUrl = '';

  await page.route('**/assets/*.js*', async (route) => {
    const url = route.request().url();
    const isAppShellChunk = /\/assets\/index-[^/]+\.js/.test(url);

    if (abortNextChunk && !isAppShellChunk) {
      abortNextChunk = false;
      abortedChunkUrl = url;
      await route.abort('failed');
      return;
    }

    await route.continue();
  });

  await page.goto('/');
  abortNextChunk = true;
  await page.getByTestId('nav-team').click();

  await expect(page.getByTestId('route-error-boundary')).toBeVisible();
  await expect(page.getByTestId('route-error-retry')).toBeVisible();
  await expect(page.getByTestId('route-error-reload')).toBeVisible();
  await expect(page.getByTestId('route-error-home')).toBeVisible();
  await expect(page.getByTestId('route-error-diagnostics')).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  expect(abortedChunkUrl).not.toBe('');
});

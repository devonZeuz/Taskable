import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

const HUD_CONTROL_TEST_IDS = [
  'toprail-nav-personal',
  'toprail-compact',
  'toprail-settings',
] as const;

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1200, height: 800 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`planner HUD controls stay in viewport at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootstrapLocalMode(page, { uiDensity: 'compact' });
    await page.goto('/planner?layoutV1=1');

    const shell = page.getByTestId('app-shell');
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute('data-density', 'compact');

    const viewportWidth =
      page.viewportSize()?.width ?? (await page.evaluate(() => window.innerWidth));

    for (const testId of HUD_CONTROL_TEST_IDS) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }

    const optionalTeamControl = page.getByTestId('toprail-nav-team');
    if (await optionalTeamControl.count()) {
      await expect(optionalTeamControl).toBeVisible();
      const box = await optionalTeamControl.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
    }

    const pageHasHorizontalScroll = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth !== root.clientWidth;
    });
    expect(pageHasHorizontalScroll).toBeFalsy();
  });
}

import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function getFirstDayColumnWidth(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const firstColumn = document.querySelector(
      '[data-testid^="day-column-"]'
    ) as HTMLElement | null;
    if (!firstColumn) return null;
    const rectWidth = firstColumn.getBoundingClientRect().width;
    if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
    const inlineWidth = Number.parseFloat(firstColumn.style.width);
    return Number.isFinite(inlineWidth) && inlineWidth > 0 ? inlineWidth : null;
  });
}

test('timeline zoom controls resize planner timeline geometry', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');
  await page.locator('[data-testid^="day-column-"]').first().waitFor();

  const initialWidth = await getFirstDayColumnWidth(page);
  expect(initialWidth).not.toBeNull();
  if (initialWidth === null) {
    throw new Error('Missing day column width.');
  }

  await page
    .getByTestId('timeline-zoom-in-personal')
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('timeline-zoom-value-personal')).toHaveText('125%');

  await expect
    .poll(async () => (await getFirstDayColumnWidth(page)) ?? 0)
    .toBeGreaterThan(initialWidth);

  await page
    .getByTestId('timeline-zoom-out-personal')
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('timeline-zoom-value-personal')).toHaveText('100%');

  await expect
    .poll(async () => Math.abs(((await getFirstDayColumnWidth(page)) ?? 0) - initialWidth))
    .toBeLessThan(1);
});

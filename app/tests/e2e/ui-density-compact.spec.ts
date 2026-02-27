import { expect, test, type Page } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function readPlannerDensityMetrics(page: Page) {
  await expect(page.locator('[data-day-row]').first()).toBeVisible();
  return page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const rows = Array.from(document.querySelectorAll('[data-day-row]')) as HTMLElement[];
    if (!board || rows.length === 0) {
      return { rowHeight: 0, visibleRows: 0 };
    }

    const boardRect = board.getBoundingClientRect();
    const visibleRows = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= boardRect.top && rect.bottom <= boardRect.bottom;
    }).length;

    return {
      rowHeight: rows[0].getBoundingClientRect().height,
      visibleRows,
    };
  });
}

test('compact density increases visible planner density without overflow', async ({ browser }) => {
  const viewport = { width: 1366, height: 768 };

  const comfortableContext = await browser.newContext({ viewport });
  const comfortablePage = await comfortableContext.newPage();
  await bootstrapLocalMode(comfortablePage, { uiDensity: 'comfortable' });
  await comfortablePage.goto('/planner?layoutV1=1');
  const comfortableMetrics = await readPlannerDensityMetrics(comfortablePage);
  await comfortableContext.close();

  expect(comfortableMetrics.rowHeight).toBeGreaterThan(0);

  const compactContext = await browser.newContext({ viewport });
  const compactPage = await compactContext.newPage();
  await bootstrapLocalMode(compactPage, { uiDensity: 'compact' });
  await compactPage.goto('/planner?layoutV1=1');
  const shell = compactPage.getByTestId('app-shell');
  await expect(shell).toHaveAttribute('data-density', 'compact');
  const compactMetrics = await readPlannerDensityMetrics(compactPage);

  expect(compactMetrics.rowHeight).toBeLessThan(comfortableMetrics.rowHeight);
  expect(compactMetrics.visibleRows).toBeGreaterThanOrEqual(comfortableMetrics.visibleRows);

  const pageHasHorizontalScroll = await compactPage.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth !== root.clientWidth;
  });
  expect(pageHasHorizontalScroll).toBeFalsy();

  const viewportWidth =
    compactPage.viewportSize()?.width ?? (await compactPage.evaluate(() => window.innerWidth));

  for (const testId of ['toprail-nav-personal', 'toprail-nav-team', 'toprail-compact'] as const) {
    const control = compactPage.getByTestId(testId);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
  }

  await compactContext.close();
});

import { expect, test, type Page } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function runDropHook(
  page: Page,
  args: { taskId: string; day: string; startTime: string; shove?: boolean }
) {
  return page.evaluate((payload) => {
    const hooks = (
      window as { __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean } }
    ).__TASKABLE_DND_HOOKS__;
    return Boolean(hooks?.dropTask?.(payload));
  }, args);
}

test('layoutV1 sidebar collapse persists and keeps scroll/DnD behavior intact', async ({
  page,
}) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true, clearStorage: false });
  await page.addInitScript(() => {
    window.localStorage.setItem('taskable:e2e-dnd', 'true');
  });
  await page.goto('/planner?layoutV1=1&e2e-dnd=1');

  await expect(page.locator('[data-day-row]').first()).toBeVisible();

  const expandedMetrics = await page.evaluate(() => {
    const toggle = document.querySelector(
      '[data-testid="sidebar-collapse-toggle-personal"]'
    ) as HTMLElement | null;
    const sidebar = toggle?.closest('aside') as HTMLElement | null;
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      boardWidth: board?.getBoundingClientRect().width ?? 0,
    };
  });

  await page.getByTestId('sidebar-collapse-toggle-personal').click();

  const collapsedMetrics = await page.evaluate(() => {
    const toggle = document.querySelector(
      '[data-testid="sidebar-collapse-toggle-personal"]'
    ) as HTMLElement | null;
    const sidebar = toggle?.closest('aside') as HTMLElement | null;
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      boardWidth: board?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(collapsedMetrics.sidebarWidth).toBeLessThan(expandedMetrics.sidebarWidth);
  expect(collapsedMetrics.boardWidth).toBeGreaterThan(expandedMetrics.boardWidth);
  await expect(page.getByTestId('layoutv1-sidebar-panel')).toHaveCount(0);

  await page.reload();

  const persistedMetrics = await page.evaluate(() => {
    const toggle = document.querySelector(
      '[data-testid="sidebar-collapse-toggle-personal"]'
    ) as HTMLElement | null;
    const sidebar = toggle?.closest('aside') as HTMLElement | null;
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      boardWidth: board?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(persistedMetrics.sidebarWidth).toBeLessThanOrEqual(90);
  await expect(page.locator('[data-testid^="day-column-"]').first()).toBeVisible();

  const geometry = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    if (!board) return { scrollHeight: 0, clientHeight: 0 };
    return {
      scrollHeight: board.scrollHeight,
      clientHeight: board.clientHeight,
    };
  });
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);

  const wheelResult = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const target = document.querySelector('[data-testid^="day-column-"]') as HTMLElement | null;
    if (!board || !target) return { prevented: false, before: 0, after: 0 };

    const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
    board.scrollTop = Math.min(maxTop, Math.max(120, board.scrollTop));
    const before = board.scrollTop;
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 260,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(wheelEvent);
    if (!wheelEvent.defaultPrevented) {
      board.scrollTop = Math.min(maxTop, Math.max(0, board.scrollTop + 260));
    }

    return { prevented: wheelEvent.defaultPrevented, before, after: board.scrollTop };
  });

  expect(wheelResult.prevented).toBeFalsy();
  expect(wheelResult.after).toBeGreaterThan(wheelResult.before);

  const todayRow = page.locator('[data-day-kind="today"]').first();
  const tomorrowRow = todayRow.locator('xpath=following-sibling::*[1]');
  const tomorrowKey = await tomorrowRow.getAttribute('data-day-row');
  if (!tomorrowKey) {
    throw new Error('Tomorrow row key is missing.');
  }

  const moved = await runDropHook(page, {
    taskId: '1',
    day: tomorrowKey,
    startTime: '11:00',
  });
  expect(moved).toBe(true);
  await expect(tomorrowRow.locator('[data-task-title="Germany Invoices"]').first()).toContainText(
    '11:00-12:00'
  );
});

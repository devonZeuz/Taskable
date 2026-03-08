import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test.beforeEach(async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner');
  await expect(page.locator('[data-day-row]').first()).toBeVisible();
});

test('board scroll owns native vertical wheel up/down in web planner', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    if (!board) {
      return { scrollHeight: 0, clientHeight: 0, canScroll: false };
    }
    return {
      scrollHeight: board.scrollHeight,
      clientHeight: board.clientHeight,
      canScroll: board.scrollHeight > board.clientHeight,
    };
  });
  expect(metrics.canScroll).toBeTruthy();
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  const downwardWheel = await page.evaluate(() => {
    const target = document.querySelector('[data-testid^="day-column-"]') as HTMLElement | null;
    const board = target?.closest('.board-scroll') as HTMLElement | null;
    if (!target || !board) {
      return { prevented: false, before: 0, after: 0 };
    }

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

    return {
      prevented: wheelEvent.defaultPrevented,
      before,
      after: board.scrollTop,
    };
  });

  expect(downwardWheel.prevented).toBeFalsy();
  expect(downwardWheel.after).toBeGreaterThanOrEqual(downwardWheel.before);

  const upwardWheel = await page.evaluate(() => {
    const target = document.querySelector('[data-testid^="day-column-"]') as HTMLElement | null;
    const board = target?.closest('.board-scroll') as HTMLElement | null;
    if (!target || !board) {
      return { prevented: false, before: 0, after: 0 };
    }

    const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
    board.scrollTop = Math.min(maxTop, Math.max(420, board.scrollTop));
    const before = board.scrollTop;
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -220,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(wheelEvent);

    if (!wheelEvent.defaultPrevented) {
      board.scrollTop = Math.min(maxTop, Math.max(0, board.scrollTop - 220));
    }

    return {
      prevented: wheelEvent.defaultPrevented,
      before,
      after: board.scrollTop,
    };
  });

  expect(upwardWheel.prevented).toBeFalsy();
  expect(upwardWheel.after).toBeLessThanOrEqual(upwardWheel.before);
});

test('timeline header wheel without shift does not hijack vertical scroll', async ({ page }) => {
  const result = await page.evaluate(() => {
    const header = document.querySelector('[data-time-axis="1"]') as HTMLElement | null;
    const board = header?.closest('.board-scroll') as HTMLElement | null;
    if (!header || !board) {
      return { prevented: false, beforeTop: 0, afterTop: 0, beforeLeft: 0, afterLeft: 0 };
    }

    const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
    board.scrollTop = Math.min(maxTop, Math.max(120, board.scrollTop));
    const beforeTop = board.scrollTop;
    const beforeLeft = board.scrollLeft;

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 240,
      bubbles: true,
      cancelable: true,
    });
    header.dispatchEvent(wheelEvent);

    if (!wheelEvent.defaultPrevented) {
      board.scrollTop = Math.min(maxTop, Math.max(0, board.scrollTop + 240));
    }

    return {
      prevented: wheelEvent.defaultPrevented,
      beforeTop,
      afterTop: board.scrollTop,
      beforeLeft,
      afterLeft: board.scrollLeft,
    };
  });

  expect(result.prevented).toBeFalsy();
  expect(result.afterTop).toBeGreaterThanOrEqual(result.beforeTop);
  expect(result.afterLeft).toBeCloseTo(result.beforeLeft, 1);
});

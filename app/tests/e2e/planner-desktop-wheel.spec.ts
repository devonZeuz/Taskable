import { expect, test } from '@playwright/test';

async function mockDesktopShell(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = {
      isDesktop: true,
      compactVisible: false,
      compactAlwaysOnTop: false,
    };

    const resolveState = async () => state;
    const noopUnsubscribe = () => undefined;

    (
      window as unknown as {
        taskableDesktop?: {
          isDesktop: boolean;
          getState: () => Promise<typeof state>;
          toggleCompact: () => Promise<typeof state>;
          openCompact: () => Promise<typeof state>;
          closeCompact: () => Promise<typeof state>;
          setAlwaysOnTop: (_enabled: boolean) => Promise<typeof state>;
          openFull: () => Promise<typeof state>;
          focusMain: () => Promise<typeof state>;
          openTask: (_taskId: string) => Promise<typeof state>;
          onStateChange: () => () => void;
        };
      }
    ).taskableDesktop = {
      isDesktop: true,
      getState: resolveState,
      toggleCompact: resolveState,
      openCompact: resolveState,
      closeCompact: resolveState,
      setAlwaysOnTop: resolveState,
      openFull: resolveState,
      focusMain: resolveState,
      openTask: resolveState,
      onStateChange: () => noopUnsubscribe,
    };

    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'local');
    window.localStorage.setItem(
      'taskable:user-preferences',
      JSON.stringify({
        schemaVersion: 7,
        preferences: {
          timelineZoom: 150,
        },
      })
    );
  });
}

async function getBoardScrollState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const firstDayRow = document.querySelector('[data-day-row]') as HTMLElement | null;
    const element = firstDayRow?.closest('.board-scroll') as HTMLElement | null;
    if (!element) {
      return {
        top: 0,
        left: 0,
        maxTop: 0,
        maxLeft: 0,
        scrollHeight: 0,
        clientHeight: 0,
        scrollWidth: 0,
        clientWidth: 0,
      };
    }
    return {
      top: element.scrollTop,
      left: element.scrollLeft,
      maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
      maxLeft: Math.max(0, element.scrollWidth - element.clientWidth),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
}

async function dispatchWheelWithNativeFallback(
  page: import('@playwright/test').Page,
  targetSelector: string,
  wheel: {
    deltaX?: number;
    deltaY?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    resetLeft?: boolean;
    resetTop?: boolean;
  }
) {
  return page.evaluate(
    ({ selector, payload }) => {
      const target = document.querySelector(selector) as HTMLElement | null;
      const board = target?.closest('.board-scroll') as HTMLElement | null;
      if (!target || !board) {
        return {
          prevented: false,
          before: { top: 0, left: 0 },
          after: { top: 0, left: 0 },
        };
      }

      if (payload.resetLeft) {
        board.scrollLeft = 0;
      }
      if (payload.resetTop) {
        board.scrollTop = 0;
      }
      const before = { top: board.scrollTop, left: board.scrollLeft };
      const event = new WheelEvent('wheel', {
        deltaX: payload.deltaX ?? 0,
        deltaY: payload.deltaY ?? 0,
        shiftKey: Boolean(payload.shiftKey),
        ctrlKey: Boolean(payload.ctrlKey),
        bubbles: true,
        cancelable: true,
      });

      target.dispatchEvent(event);

      const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
      const nextTop = Math.min(maxTop, Math.max(0, board.scrollTop + (payload.deltaY ?? 0)));
      board.scrollTop = nextTop;

      return {
        prevented: event.defaultPrevented,
        before,
        after: { top: board.scrollTop, left: board.scrollLeft },
      };
    },
    { selector: targetSelector, payload: wheel }
  );
}

test('board-scroll overflows vertically and wheel over day grid increases scrollTop', async ({
  page,
}) => {
  await mockDesktopShell(page);

  await page.goto('/planner');
  await expect(page.locator('[data-day-row]').first()).toBeVisible();

  const before = await getBoardScrollState(page);
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.maxTop).toBeGreaterThan(0);
  const result = await dispatchWheelWithNativeFallback(page, '[data-testid^="day-column-"]', {
    deltaY: 320,
  });
  expect(result.after.top).toBeGreaterThan(result.before.top);
});

test('shift+wheel over timeline header increases board scrollLeft', async ({ page }) => {
  await mockDesktopShell(page);

  await page.goto('/planner');
  await expect(page.locator('[data-day-row]').first()).toBeVisible();

  const before = await getBoardScrollState(page);
  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
  expect(before.maxLeft).toBeGreaterThan(0);
  const result = await dispatchWheelWithNativeFallback(page, '[data-time-axis="1"]', {
    deltaY: 320,
    shiftKey: true,
    resetLeft: true,
  });
  expect(result.after.left).toBeGreaterThan(result.before.left);
});

test('wheel over timeline header without shift keeps vertical board scrolling', async ({
  page,
}) => {
  await mockDesktopShell(page);

  await page.goto('/planner');
  await expect(page.locator('[data-day-row]').first()).toBeVisible();

  const before = await getBoardScrollState(page);
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.maxTop).toBeGreaterThan(0);

  const result = await dispatchWheelWithNativeFallback(page, '[data-time-axis="1"]', {
    deltaY: 320,
  });
  expect(result.after.top).toBeGreaterThan(result.before.top);
  expect(result.after.left).toBeCloseTo(result.before.left, 1);
});

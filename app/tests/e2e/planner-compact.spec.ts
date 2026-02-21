import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.goto('/compact');
});

test('opens compact route with compact board layout', async ({ page }) => {
  await expect(page.getByTestId('compact-view')).toBeVisible();
  await expect(page.locator('[data-testid^="compact-day-"]')).toHaveCount(5);
  await expect(page.locator('[data-task-title="Monthly Reports"]').first()).toBeVisible();
});

test('compact view renders token-aligned spacing classes', async ({ page }) => {
  const compactRoot = page.getByTestId('compact-view');
  await expect(compactRoot).toHaveAttribute('data-compact-spacing', 'token-v1');
  await expect(compactRoot).toHaveClass(/compact-token-layout/);
  await expect(page.locator('.compact-token-day-label').first()).toBeVisible();
  await expect(page.locator('.compact-token-day-title').first()).toBeVisible();
  await expect(page.locator('.compact-token-task-card').first()).toBeVisible();
});

test('compact cards are visual-only and open full view when clicked', async ({ page }) => {
  const monthlyCard = page.locator('[data-task-title="Monthly Reports"]').first();
  await expect(monthlyCard).toBeVisible();
  await expect(monthlyCard.getByRole('button')).toHaveCount(0);

  await monthlyCard.click();
  await expect(page).not.toHaveURL(/\/compact/);
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await expect(page.getByLabel('Task Title')).toHaveValue('Monthly Reports');
});

test('open full button leaves compact route', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Full' }).click();

  await expect(page).not.toHaveURL(/\/compact/);
  await expect(page.getByTestId('task-dialog-form')).not.toBeVisible();
  await expect(page.getByTestId('daily-planning-panel')).toBeVisible();
});

test('desktop compact mode limits layout to two days', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      isDesktop: true,
      compactVisible: false,
      compactAlwaysOnTop: false,
    };
    const resolveState = async () => state;
    (
      window as unknown as {
        taskableDesktop?: {
          isDesktop: boolean;
          getState: () => Promise<typeof state>;
          toggleCompact: () => Promise<typeof state>;
          openCompact: () => Promise<typeof state>;
          closeCompact: () => Promise<typeof state>;
          setAlwaysOnTop: () => Promise<typeof state>;
          openFull: () => Promise<typeof state>;
          focusMain: () => Promise<typeof state>;
          openTask: () => Promise<typeof state>;
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
      onStateChange: () => () => undefined,
    };
  });
  await page.goto('/compact?desktopCompact=1');
  await expect(page.locator('[data-testid^="compact-day-"]')).toHaveCount(2);
});

test('compact board supports vertical wheel scrolling away from header', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.evaluate(() => {
    localStorage.setItem(
      'taskable:user-preferences',
      JSON.stringify({
        schemaVersion: 5,
        preferences: {
          compactEnabled: true,
          compactDaysShown: 7,
        },
      })
    );
  });
  await page.reload();

  const board = page.locator('[data-testid="compact-view"] .board-scroll');
  await expect(board).toBeVisible();
  await board.evaluate((node) => {
    const element = node as HTMLElement;
    element.style.height = '220px';
    element.style.maxHeight = '220px';
    element.style.minHeight = '220px';
  });

  const canScrollVertically = await board.evaluate((node) => {
    const element = node as HTMLElement;
    return element.scrollHeight > element.clientHeight;
  });
  expect(canScrollVertically).toBeTruthy();

  const wheelResult = await page.evaluate(() => {
    const target = document.querySelector('[data-testid^="compact-day-"]') as HTMLElement | null;
    const boardElement = target?.closest('.board-scroll') as HTMLElement | null;
    if (!target || !boardElement) {
      return {
        prevented: false,
        beforeScrollTop: 0,
        afterScrollTop: 0,
      };
    }

    const beforeScrollTop = boardElement.scrollTop;
    const event = new WheelEvent('wheel', {
      deltaY: 220,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) {
      const maxTop = Math.max(0, boardElement.scrollHeight - boardElement.clientHeight);
      boardElement.scrollTop = Math.min(maxTop, Math.max(0, boardElement.scrollTop + 220));
    }
    return {
      prevented: event.defaultPrevented,
      beforeScrollTop,
      afterScrollTop: boardElement.scrollTop,
    };
  });

  expect(wheelResult.prevented).toBeFalsy();
  expect(wheelResult.afterScrollTop).toBeGreaterThan(wheelResult.beforeScrollTop);
});

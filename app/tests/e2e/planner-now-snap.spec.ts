import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

function installFixedDate(page: import('@playwright/test').Page, isoLocalDateTime: string) {
  return page.addInitScript((fixedIso) => {
    const fixedMs = new Date(fixedIso).getTime();
    const RealDate = Date;

    class MockDate extends RealDate {
      constructor(...args: [] | ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(fixedMs);
          return;
        }
        super(...args);
      }

      static now() {
        return fixedMs;
      }
    }

    window.Date = MockDate as unknown as DateConstructor;
  }, isoLocalDateTime);
}

async function bootstrapDeterministicDnd(page: import('@playwright/test').Page) {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.addInitScript(() => {
    window.localStorage.setItem('taskable:e2e-dnd', 'true');
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

test('planner soft-snaps timeline to current time on initial load', async ({ page }) => {
  await installFixedDate(page, '2026-02-21T13:30:00');
  await bootstrapLocalMode(page);
  await page.addInitScript(() => {
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
  await page.goto('/planner');

  await expect(page.locator('.board-scroll')).toBeVisible();
  await expect
    .poll(() => page.locator('.board-scroll').evaluate((node) => (node as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);

  const nowIndicatorWithinViewport = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const nowIndicator = document.querySelector(
      '[data-testid="timeline-now-indicator"]'
    ) as HTMLElement | null;
    if (!board || !nowIndicator) return false;
    const boardRect = board.getBoundingClientRect();
    const nowRect = nowIndicator.getBoundingClientRect();
    const centerX = nowRect.left + nowRect.width / 2;
    return centerX >= boardRect.left && centerX <= boardRect.right;
  });

  expect(nowIndicatorWithinViewport).toBe(true);
});

test('day labels stay pinned while timeline scrolls horizontally and tasks remain draggable', async ({
  page,
}) => {
  await bootstrapDeterministicDnd(page);
  await page.goto('/planner?e2e-dnd=1');

  await expect(page.getByTestId('task-card-1')).toBeVisible();

  const pinnedBefore = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const dayLabel = document.querySelector('[data-testid="day-label-cell"]') as HTMLElement | null;
    if (!board || !dayLabel) return null;
    const boardRect = board.getBoundingClientRect();
    const labelRect = dayLabel.getBoundingClientRect();
    return {
      delta: Math.abs(labelRect.left - boardRect.left),
    };
  });
  expect(pinnedBefore).not.toBeNull();

  await page.locator('.board-scroll').evaluate((node) => {
    const element = node as HTMLElement;
    const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    element.scrollLeft = Math.min(maxLeft, 760);
  });

  const pinnedAfter = await page.evaluate(() => {
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const dayLabel = document.querySelector('[data-testid="day-label-cell"]') as HTMLElement | null;
    if (!board || !dayLabel) return null;
    const boardRect = board.getBoundingClientRect();
    const labelRect = dayLabel.getBoundingClientRect();
    return {
      delta: Math.abs(labelRect.left - boardRect.left),
    };
  });
  expect(pinnedAfter).not.toBeNull();
  expect((pinnedAfter as { delta: number }).delta).toBeLessThanOrEqual(6);

  const todayKey = await page
    .locator('[data-day-kind="today"]')
    .first()
    .getAttribute('data-day-row');
  if (!todayKey) {
    throw new Error('Today row key is missing.');
  }

  const moved = await page.evaluate((day) => {
    const hooks = (
      window as { __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean } }
    ).__TASKABLE_DND_HOOKS__;
    return Boolean(hooks?.dropTask?.({ taskId: '1', day, startTime: '11:00' }));
  }, todayKey);

  expect(moved).toBe(true);
  await expect(page.locator('[data-task-title="Germany Invoices"]').first()).toContainText(
    /11:00\s*-\s*12:00/
  );
});

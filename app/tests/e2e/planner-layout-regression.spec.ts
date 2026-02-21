import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('app shell fills viewport and body paints app theme background', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner');
  await expect(page.locator('[data-day-row]').first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="app-shell"]') as HTMLElement | null;
    const board = document.querySelector('.board-scroll') as HTMLElement | null;
    const shellHeight = shell?.getBoundingClientRect().height ?? 0;
    const boardBottom = board?.getBoundingClientRect().bottom ?? 0;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const bodyBackground = window.getComputedStyle(document.body).backgroundColor;

    return {
      shellHeight,
      boardBottom,
      viewportHeight,
      bodyBackground,
    };
  });

  expect(layout.bodyBackground).not.toBe('rgb(255, 255, 255)');
  expect(layout.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(layout.shellHeight).toBeGreaterThanOrEqual(layout.viewportHeight - 2);
  expect(layout.boardBottom).toBeGreaterThanOrEqual(layout.viewportHeight - 24);
});

test('overlap + scroll + resize keeps task cards within planner layout bounds', async ({
  page,
}) => {
  await bootstrapLocalMode(page);
  await page.addInitScript(() => {
    localStorage.setItem('taskable:mode', 'local');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const makeTask = (
      id: string,
      title: string,
      hour: number,
      minute: number,
      durationMinutes: number,
      color: string
    ) => {
      const start = new Date(today);
      start.setHours(hour, minute, 0, 0);
      return {
        id,
        title,
        description: '',
        startDateTime: start.toISOString(),
        durationMinutes,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        completed: false,
        color,
        subtasks: [],
        type: 'quick',
        assignedTo: 'user1',
        status: 'scheduled',
        focus: false,
        executionStatus: 'idle',
        actualMinutes: 0,
      };
    };

    localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          makeTask('ov1', 'Overlap A', 9, 0, 180, '#c9ced8'),
          makeTask('ov2', 'Overlap B', 9, 30, 150, '#8d929c'),
          makeTask('ov3', 'Overlap C', 10, 0, 120, '#2d2f33'),
        ],
      })
    );
  });

  await page.goto('/planner');
  await expect(page.getByTestId('task-card-ov1')).toBeVisible();
  await expect(page.getByTestId('task-card-ov2')).toBeVisible();
  await expect(page.getByTestId('task-card-ov3')).toBeVisible();

  const resizeHandle = page.getByTestId('resize-end-ov1');
  const resizeHandleBox = await resizeHandle.boundingBox();
  expect(resizeHandleBox).not.toBeNull();
  if (resizeHandleBox) {
    await page.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width * 0.5,
      resizeHandleBox.y + resizeHandleBox.height * 0.5
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width * 0.5 + 72,
      resizeHandleBox.y + resizeHandleBox.height * 0.5,
      { steps: 8 }
    );
    await page.mouse.up();
  }

  const board = page.locator('.board-scroll').first();
  const wheelScroll = await page.evaluate(() => {
    const target = document.querySelector('[data-testid^="day-column-"]') as HTMLElement | null;
    const boardElement = target?.closest('.board-scroll') as HTMLElement | null;
    if (!target || !boardElement) {
      return { before: 0, after: 0 };
    }
    const before = boardElement.scrollTop;
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
    return { before, after: boardElement.scrollTop };
  });
  expect(wheelScroll.after).toBeGreaterThanOrEqual(wheelScroll.before);

  await board.evaluate((node) => {
    (node as HTMLElement).scrollTop = 0;
  });

  const layoutState = await page.evaluate(() => {
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const header = document.querySelector('[data-time-axis="1"]') as HTMLElement | null;
    const footer = document.querySelector('[data-testid="nav-personal"]') as HTMLElement | null;
    const headerRect = header?.getBoundingClientRect() ?? null;
    const footerRect = footer?.getBoundingClientRect() ?? null;

    let headerIntersection = 0;
    let footerIntersection = 0;
    let outsideColumn = 0;

    const cards = Array.from(
      document.querySelectorAll('[data-testid^="task-card-"]')
    ) as HTMLElement[];
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (headerRect && intersects(rect, headerRect)) {
        headerIntersection += 1;
      }
      if (footerRect && intersects(rect, footerRect)) {
        footerIntersection += 1;
      }

      const column = card.closest('[data-testid^="day-column-"]') as HTMLElement | null;
      if (!column) return;
      const columnRect = column.getBoundingClientRect();
      const withinColumn =
        rect.left >= columnRect.left - 1 &&
        rect.right <= columnRect.right + 1 &&
        rect.top >= columnRect.top - 1 &&
        rect.bottom <= columnRect.bottom + 1;
      if (!withinColumn) {
        outsideColumn += 1;
      }
    });

    return {
      cardCount: cards.length,
      headerIntersection,
      footerIntersection,
      outsideColumn,
    };
  });

  expect(layoutState.cardCount).toBeGreaterThan(0);
  expect(layoutState.headerIntersection).toBe(0);
  expect(layoutState.footerIntersection).toBe(0);
  expect(layoutState.outsideColumn).toBe(0);
});

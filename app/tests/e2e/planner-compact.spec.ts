import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test.beforeEach(async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
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

test('compact cards consume ui-system compact spacing tokens', async ({ page }) => {
  const firstCard = page.locator('.compact-token-task-card').first();
  await expect(firstCard).toBeVisible();

  const measurements = await firstCard.evaluate((node) => {
    const styles = window.getComputedStyle(node as HTMLElement);
    return {
      paddingTop: styles.paddingTop,
      borderRadius: styles.borderTopLeftRadius,
      boxShadow: styles.boxShadow,
    };
  });

  expect(measurements.paddingTop).toBe('10px');
  expect(measurements.borderRadius).toBe('12px');
  expect(measurements.boxShadow).not.toBe('none');
});

test('compact staggered cards stay inside day row bounds', async ({ page }) => {
  await page.evaluate(() => {
    const raw = window.localStorage.getItem('taskable-tasks');
    const parsed = raw ? (JSON.parse(raw) as { schemaVersion: number; tasks: unknown[] }) : null;
    const schemaVersion = parsed?.schemaVersion ?? 4;
    const existingTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    const tasks = existingTasks.filter((task) => {
      if (!task || typeof task !== 'object') return true;
      const id = (task as { id?: unknown }).id;
      return typeof id !== 'string' || !id.startsWith('compact-clip-');
    }) as Array<Record<string, unknown>>;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const makeIso = (hour: number, minute: number) => {
      const date = new Date(today);
      date.setHours(hour, minute, 0, 0);
      return date.toISOString();
    };

    const dense = [
      { id: 'compact-clip-a', title: 'New Task', startDateTime: makeIso(8, 0), durationMinutes: 60 },
      { id: 'compact-clip-b', title: 'New Task', startDateTime: makeIso(9, 0), durationMinutes: 60 },
      { id: 'compact-clip-c', title: 'New Task', startDateTime: makeIso(10, 0), durationMinutes: 60 },
      { id: 'compact-clip-d', title: 'New Task', startDateTime: makeIso(10, 0), durationMinutes: 60 },
      { id: 'compact-clip-e', title: 'New Task', startDateTime: makeIso(11, 0), durationMinutes: 60 },
      { id: 'compact-clip-f', title: 'New Task', startDateTime: makeIso(11, 0), durationMinutes: 60 },
    ].map((task, index) => ({
      description: '',
      timeZone: 'UTC',
      completed: false,
      color: index % 2 === 0 ? '#d43f97' : '#e084bf',
      subtasks: [],
      type: 'quick',
      assignedTo: 'user1',
      status: 'scheduled',
      ...task,
    }));

    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion,
        tasks: [...tasks, ...dense],
      })
    );
  });
  await page.reload();

  const overflow = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="compact-day-"]')
    );
    const issues: Array<{ day: string; task: string; cardBottom: number; rowBottom: number }> = [];

    rows.forEach((row) => {
      const day = row.getAttribute('data-testid') ?? 'unknown-day';
      const rowRect = row.getBoundingClientRect();
      const cards = Array.from(
        row.querySelectorAll<HTMLElement>('[data-testid^="compact-task-card-"]')
      );
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        if (cardRect.bottom > rowRect.bottom + 0.5) {
          issues.push({
            day,
            task: card.getAttribute('data-task-id') ?? 'unknown-task',
            cardBottom: cardRect.bottom,
            rowBottom: rowRect.bottom,
          });
        }
      });
    });

    return issues;
  });

  expect(overflow).toEqual([]);
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
    window.localStorage.setItem('taskable:mode', 'local');
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

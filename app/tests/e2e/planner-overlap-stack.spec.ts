import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('overlapping tasks occupy independent vertical lanes and keep resize/drop interactions', async ({
  page,
}) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buildTask = (id: string, title: string, durationMinutes: number, color: string) => {
      const start = new Date(today);
      start.setHours(9, 0, 0, 0);
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

    window.localStorage.setItem('taskable:e2e-dnd', 'true');
    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          buildTask('stack-a', 'Stack A', 120, '#c9ced8'),
          buildTask('stack-b', 'Stack B', 90, '#8d929c'),
        ],
      })
    );
  });

  await page.goto('/planner?e2e-dnd=1');
  const stackA = page.getByTestId('task-card-stack-a');
  const stackB = page.getByTestId('task-card-stack-b');

  await expect(stackA).toBeVisible();
  await expect(stackB).toBeVisible();

  const geometry = await page.evaluate(() => {
    const first = document.querySelector('[data-testid="task-card-stack-a"]') as HTMLElement | null;
    const second = document.querySelector(
      '[data-testid="task-card-stack-b"]'
    ) as HTMLElement | null;
    if (!first || !second) return null;

    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();

    return {
      leftDelta: Math.abs(firstRect.left - secondRect.left),
      topDelta: Math.abs(firstRect.top - secondRect.top),
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) {
    throw new Error('Task card geometry was not available.');
  }
  expect(geometry.leftDelta).toBeLessThanOrEqual(6);
  expect(geometry.topDelta).toBeGreaterThanOrEqual(120);
  expect(geometry.topDelta).toBeLessThanOrEqual(220);

  const dndResult = await page.evaluate(() => {
    const todayRow = document.querySelector('[data-day-kind="today"]') as HTMLElement | null;
    const day = todayRow?.getAttribute('data-day-row');
    const hooks = (
      window as unknown as {
        __TASKABLE_DND_HOOKS__?: {
          resizeTask?: (input: unknown) => boolean;
          dropTask?: (input: unknown) => boolean;
        };
      }
    ).__TASKABLE_DND_HOOKS__;

    if (!day || !hooks?.resizeTask || !hooks?.dropTask) {
      return { resized: false, moved: false };
    }

    const resized = hooks.resizeTask({
      taskId: 'stack-a',
      day,
      durationMinutes: 150,
    });
    const moved = hooks.dropTask({
      taskId: 'stack-a',
      day,
      startTime: '12:30',
    });

    return { resized, moved };
  });

  expect(dndResult.resized).toBe(true);
  expect(dndResult.moved).toBe(true);
  await expect(stackA).toContainText('12:30');
});

test('staggered placement alternates card vertical offset across adjacent hours', async ({
  page,
}) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buildTask = (id: string, title: string, hour: number) => {
      const start = new Date(today);
      start.setHours(hour, 0, 0, 0);
      return {
        id,
        title,
        description: '',
        startDateTime: start.toISOString(),
        durationMinutes: 60,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        completed: false,
        color: '#c9ced8',
        subtasks: [],
        type: 'quick',
        assignedTo: 'user1',
        status: 'scheduled',
        focus: false,
        executionStatus: 'idle',
        actualMinutes: 0,
      };
    };

    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          buildTask('stagger-a', 'Stagger A', 9),
          buildTask('stagger-b', 'Stagger B', 10),
          buildTask('stagger-c', 'Stagger C', 11),
        ],
      })
    );
  });

  await page.goto('/planner');
  const staggerA = page.getByTestId('task-card-stagger-a');
  const staggerB = page.getByTestId('task-card-stagger-b');
  const staggerC = page.getByTestId('task-card-stagger-c');
  await expect(staggerA).toBeVisible();
  await expect(staggerB).toBeVisible();
  await expect(staggerC).toBeVisible();

  const geometry = await page.evaluate(() => {
    const first = document.querySelector(
      '[data-testid="task-card-stagger-a"]'
    ) as HTMLElement | null;
    const second = document.querySelector(
      '[data-testid="task-card-stagger-b"]'
    ) as HTMLElement | null;
    const third = document.querySelector(
      '[data-testid="task-card-stagger-c"]'
    ) as HTMLElement | null;
    if (!first || !second || !third) return null;

    return {
      topA: first.getBoundingClientRect().top,
      topB: second.getBoundingClientRect().top,
      topC: third.getBoundingClientRect().top,
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) {
    throw new Error('Stagger card geometry was not available.');
  }
  expect(Math.abs(geometry.topA - geometry.topB)).toBeGreaterThanOrEqual(14);
  expect(Math.abs(geometry.topA - geometry.topC)).toBeLessThanOrEqual(4);
});

test('same-bucket overlaps always stack while non-overlap reuses base lane', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buildTask = (id: string, title: string, hour: number, durationMinutes: number) => {
      const start = new Date(today);
      start.setHours(hour, 0, 0, 0);
      return {
        id,
        title,
        description: '',
        startDateTime: start.toISOString(),
        durationMinutes,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        completed: false,
        color: '#c9ced8',
        subtasks: [],
        type: 'quick',
        assignedTo: 'user1',
        status: 'scheduled',
        focus: false,
        executionStatus: 'idle',
        actualMinutes: 0,
        version: 0,
      };
    };

    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          buildTask('det-a', 'Det A', 9, 90),
          buildTask('det-b', 'Det B', 9, 60),
          buildTask('det-c', 'Det C', 11, 60),
        ],
      })
    );
  });

  await page.goto('/planner');
  await expect(page.getByTestId('task-card-det-a')).toBeVisible();
  await expect(page.getByTestId('task-card-det-b')).toBeVisible();
  await expect(page.getByTestId('task-card-det-c')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="task-card-det-a"]') as HTMLElement | null;
    const b = document.querySelector('[data-testid="task-card-det-b"]') as HTMLElement | null;
    const c = document.querySelector('[data-testid="task-card-det-c"]') as HTMLElement | null;
    if (!a || !b || !c) return null;
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    const rectC = c.getBoundingClientRect();
    return {
      topA: rectA.top,
      topB: rectB.top,
      topC: rectC.top,
      leftA: rectA.left,
      leftB: rectB.left,
      leftC: rectC.left,
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) {
    throw new Error('Could not read overlap geometry.');
  }

  expect(Math.abs(geometry.leftA - geometry.leftB)).toBeLessThanOrEqual(6);
  expect(Math.abs(geometry.topA - geometry.topB)).toBeGreaterThanOrEqual(120);
  expect(Math.abs(geometry.topA - geometry.topC)).toBeLessThanOrEqual(8);
  expect(Math.abs(geometry.leftA - geometry.leftC)).toBeGreaterThan(120);
});

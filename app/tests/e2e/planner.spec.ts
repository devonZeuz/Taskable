import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function openTaskEditor(page: import('@playwright/test').Page, taskTitle: string) {
  const title = page.locator(`[data-task-title="${taskTitle}"] h3`).first();
  await title.scrollIntoViewIfNeeded();
  await title.evaluate((node) => {
    (node as HTMLElement).click();
  });
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
}

async function setStartTime(page: import('@playwright/test').Page, time: string) {
  const dialog = page.getByTestId('task-dialog-form');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: time }).click();
}

async function openTaskQuickActions(page: import('@playwright/test').Page, taskTitle: string) {
  const card = page.locator(`[data-task-title="${taskTitle}"]`).first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) {
    throw new Error(`Could not locate task card bounds for "${taskTitle}".`);
  }
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await expect(page.getByTestId('task-quick-actions-hub')).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');
});

test('creates a task from dialog', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('E2E Create Task');
  await page.getByTestId('create-task-submit').click();

  await expect(page.locator('[data-task-title="E2E Create Task"]')).toBeVisible();
});

test('creates task with default name when title is left unchanged', async ({ page }) => {
  const before = await page.evaluate(() => {
    const raw = window.localStorage.getItem('taskable-tasks');
    if (!raw) return { total: 0, newTaskCount: 0 };
    const parsed = JSON.parse(raw) as { tasks?: Array<{ title?: string }> };
    const tasks = parsed.tasks ?? [];
    return {
      total: tasks.length,
      newTaskCount: tasks.filter((task) => task.title === 'New Task').length,
    };
  });

  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByLabel('Task Title')).toHaveValue('New Task');
  await page.getByTestId('create-task-submit').click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const raw = window.localStorage.getItem('taskable-tasks');
        if (!raw) return { total: 0, newTaskCount: 0 };
        const parsed = JSON.parse(raw) as { tasks?: Array<{ title?: string }> };
        const tasks = parsed.tasks ?? [];
        return {
          total: tasks.length,
          newTaskCount: tasks.filter((task) => task.title === 'New Task').length,
        };
      });
    })
    .toEqual({
      total: before.total + 1,
      newTaskCount: before.newTaskCount + 1,
    });
});

test('quick add cancel does not create a placeholder task', async ({ page }) => {
  const beforeCount = await page.evaluate(() => {
    const raw = window.localStorage.getItem('taskable-tasks');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string }> };
    return parsed.tasks?.length ?? 0;
  });

  await page.locator('button[data-testid^="quick-add-"]').first().click({ force: true });
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('task-dialog-form')).toHaveCount(0);

  const afterState = await page.evaluate(() => {
    const raw = window.localStorage.getItem('taskable-tasks');
    if (!raw) return { count: 0, hasPlaceholder: false };
    const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string; title?: string }> };
    const tasks = parsed.tasks ?? [];
    return {
      count: tasks.length,
      hasPlaceholder: tasks.some((task) => task.title === 'New Task'),
    };
  });

  expect(afterState.count).toBe(beforeCount);
  expect(afterState.hasPlaceholder).toBe(false);
});

test('empty slot affordance reveals plus on hover without forcing crosshair cursor', async ({
  page,
}) => {
  const firstQuickAdd = page.locator('button[data-testid^="quick-add-"]').first();
  await expect(firstQuickAdd).toBeVisible();
  await expect(firstQuickAdd).toHaveCSS('opacity', '0');

  const parentCursorBefore = await firstQuickAdd.evaluate(
    (node) => window.getComputedStyle((node as HTMLElement).parentElement as HTMLElement).cursor
  );
  expect(parentCursorBefore).toBe('auto');

  await firstQuickAdd.hover();
  await expect
    .poll(async () =>
      Number.parseFloat(
        await firstQuickAdd.evaluate((node) => getComputedStyle(node as HTMLElement).opacity)
      )
    )
    .toBeGreaterThan(0.55);
});

test('task action strip reflects execution state', async ({ page }) => {
  const idleStrip = page.getByTestId('task-action-strip-3');
  await expect(idleStrip).toHaveAttribute('data-execution-state', 'idle');
  await expect(idleStrip).toContainText('Start');

  await idleStrip.click();
  await expect(idleStrip).toHaveAttribute('data-execution-state', 'running');
  await expect(idleStrip).toContainText('Running · Pause');

  await idleStrip.click();
  await expect(idleStrip).toHaveAttribute('data-execution-state', 'idle');

  const completedStrip = page.getByTestId('task-action-strip-1');
  await expect(completedStrip).toHaveAttribute('data-execution-state', 'completed');
  await expect(completedStrip).toContainText('Reopen');
});

test('updates a task time through the edit dialog', async ({ page }) => {
  await openTaskEditor(page, 'Germany Invoices');
  await setStartTime(page, '10:00');
  await page.getByTestId('update-task-submit').click();

  await expect(page.locator('[data-task-title="Germany Invoices"]').first()).toContainText(
    '10:00-11:00'
  );
});

test('updates task duration through the edit dialog', async ({ page }) => {
  await openTaskEditor(page, 'Monthly Reports');
  const dialog = page.getByTestId('task-dialog-form');
  await dialog.getByLabel('Duration (minutes)').fill('150');
  await page.getByTestId('update-task-submit').click();

  await expect(page.locator('[data-task-title="Monthly Reports"]').first()).toContainText(
    /10:00\s*-\s*12:30/
  );
});

test('quick actions hub exposes execution actions', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Hub Extend Task');
  await setStartTime(page, '13:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByTestId('create-task-submit').click();

  await openTaskQuickActions(page, 'Hub Extend Task');
  const hub = page.getByTestId('task-quick-actions-hub');
  await expect(hub.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(hub.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(hub.getByRole('button', { name: 'Extend' })).toBeVisible();
  await expect(hub.getByRole('button', { name: 'Next' })).toBeVisible();
});

test('quick actions hub marks running task done', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Hub Done Task');
  await setStartTime(page, '14:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByTestId('create-task-submit').click();

  const card = await openTaskQuickActions(page, 'Hub Done Task');
  const hub = page.getByTestId('task-quick-actions-hub');
  await hub.getByRole('button', { name: 'Start' }).click();

  await openTaskQuickActions(page, 'Hub Done Task');
  await hub.getByRole('button', { name: 'Done' }).click();

  await expect(card).toContainText('Reopen');
});

test('can still open add-task dialog after starting a task', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Post Start Task');
  await setStartTime(page, '14:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByTestId('create-task-submit').click();

  await openTaskQuickActions(page, 'Post Start Task');
  const hub = page.getByTestId('task-quick-actions-hub');
  await hub.getByRole('button', { name: 'Start' }).click();
  await expect(hub).toBeVisible();

  await page.getByTestId('add-task-trigger').first().click();
  const dialog = page.getByTestId('task-dialog-form');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(dialog).toBeVisible();
});

test('quick add dialog stays open after a task is already running', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Running Anchor Task');
  await setStartTime(page, '14:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByTestId('create-task-submit').click();

  await openTaskQuickActions(page, 'Running Anchor Task');
  const hub = page.getByTestId('task-quick-actions-hub');
  await hub.getByRole('button', { name: 'Start' }).click();
  await expect(hub).toBeVisible();

  await page.locator('button[data-testid^="quick-add-"]').first().click({ force: true });
  const dialog = page.getByTestId('task-dialog-form');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(dialog).toBeVisible();
});

test('moves a scheduled task to inbox', async ({ page }) => {
  await openTaskEditor(page, 'Germany Invoices');
  await page.getByRole('button', { name: 'Advanced options' }).click();
  await page.getByTestId('schedule-later-toggle').click();
  await page.getByTestId('update-task-submit').click();

  const inbox = page.getByTestId('inbox-panel');
  await expect(inbox.locator('[data-task-title="Germany Invoices"]')).toBeVisible();
});

test('filters team view by unassigned member bucket', async ({ page }) => {
  await page.goto('/team');
  await expect(page).toHaveURL(/\/team$/);
  const seeded = await page.evaluate(() => {
    const raw = window.localStorage.getItem('taskable-tasks');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number;
      tasks?: Array<Record<string, unknown>>;
    };
    const tasks = parsed.tasks ?? [];
    const now = new Date();
    now.setHours(14, 0, 0, 0);
    tasks.push({
      id: `e2e-unassigned-${Date.now()}`,
      title: 'Unassigned E2E',
      description: '',
      startDateTime: now.toISOString(),
      durationMinutes: 60,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      completed: false,
      color: '#8d929c',
      subtasks: [],
      type: 'quick',
      status: 'scheduled',
      focus: false,
      executionStatus: 'idle',
      actualMinutes: 0,
      version: 1,
    });
    const payload = {
      schemaVersion: parsed.schemaVersion ?? 4,
      tasks,
    };
    window.localStorage.setItem('taskable-tasks', JSON.stringify(payload));
    if ('BroadcastChannel' in window) {
      const syncChannel = new BroadcastChannel('taskable:tasks-sync');
      syncChannel.postMessage({ sourceId: 'e2e-seed', tasks: payload.tasks });
      syncChannel.close();
    }
    return true;
  });
  expect(seeded).toBe(true);
  await expect(page.locator('[data-task-title="Unassigned E2E"]')).toBeVisible();

  await page.getByTestId('team-filter-trigger').click();
  await page.getByTestId('team-filter-unassigned').click();

  await expect(page.locator('[data-task-title="Unassigned E2E"]')).toBeVisible();
  await expect(page.locator('[data-task-title="Germany Invoices"]')).toHaveCount(0);
});

test('keeps inbox queue in sidebar only', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Auto Place E2E');
  await page.getByRole('button', { name: 'Advanced options' }).click();
  await page.getByTestId('schedule-later-toggle').click();
  await page.getByTestId('create-task-submit').click();

  const planningPanel = page.getByTestId('daily-planning-panel');
  const collapseToggle = planningPanel.getByTestId('daily-planning-collapse-toggle');
  if ((await collapseToggle.textContent())?.includes('Expand')) {
    await collapseToggle.click();
  }
  await expect(planningPanel).not.toContainText('Inbox Queue');

  const sidebarInbox = page.locator('[data-testid="inbox-panel"]').filter({ hasText: 'Inbox' });
  await expect(sidebarInbox).toBeVisible();
  await expect(sidebarInbox.locator('[data-task-title="Auto Place E2E"]')).toBeVisible();
});

test('supports undo and redo keyboard shortcuts', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Undo Redo E2E');
  await page.getByTestId('create-task-submit').click();

  const createdTask = page.locator('[data-task-title="Undo Redo E2E"]');
  await expect(createdTask).toBeVisible();

  await page.keyboard.press('Control+KeyZ');
  await expect(createdTask).toHaveCount(0);

  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(createdTask).toBeVisible();
});

test('undo history is linear, bounded behavior preserved, and redo clears after new action', async ({
  page,
}) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setHours(9, 0, 0, 0);

    window.localStorage.setItem('taskable:e2e-dnd', 'true');
    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          {
            id: 'undo-seq',
            title: 'Undo Sequence',
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
            version: 0,
          },
        ],
      })
    );
  });

  await page.goto('/planner?e2e-dnd=1');
  await expect(page.getByTestId('task-card-undo-seq')).toBeVisible();

  const day = await page.locator('[data-day-kind="today"]').first().getAttribute('data-day-row');
  expect(day).toBeTruthy();
  if (!day) throw new Error('Missing today key for undo sequence test.');

  const moveResults = await page.evaluate((todayKey) => {
    const hooks = (
      window as {
        __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean };
      }
    ).__TASKABLE_DND_HOOKS__;
    if (!hooks?.dropTask) return [];
    const slots = ['09:15', '09:30', '09:45', '10:00', '10:15'];
    return slots.map((startTime) =>
      hooks.dropTask?.({
        taskId: 'undo-seq',
        day: todayKey,
        startTime,
      })
    );
  }, day);

  expect(moveResults.every(Boolean)).toBe(true);
  await expect(page.getByTestId('task-card-undo-seq')).toContainText(/10:15\s*-\s*11:15/);

  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Control+KeyZ');
  }
  await expect(page.getByTestId('task-card-undo-seq')).toContainText(/09:00\s*-\s*10:00/);

  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(page.getByTestId('task-card-undo-seq')).toContainText(/09:15\s*-\s*10:15/);

  const movedAfterRedo = await page.evaluate((todayKey) => {
    const hooks = (
      window as {
        __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean };
      }
    ).__TASKABLE_DND_HOOKS__;
    return Boolean(
      hooks?.dropTask?.({
        taskId: 'undo-seq',
        day: todayKey,
        startTime: '11:00',
      })
    );
  }, day);
  expect(movedAfterRedo).toBe(true);
  await expect(page.getByTestId('task-card-undo-seq')).toContainText(/11:00\s*-\s*12:00/);

  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(page.getByTestId('task-card-undo-seq')).toContainText(/11:00\s*-\s*12:00/);
});

test('deletes selected task with keyboard and restores with undo', async ({ page }) => {
  const monthlyTask = page.getByTestId('task-card-3');
  await expect(monthlyTask).toBeVisible();

  await monthlyTask.click();
  await expect(monthlyTask).toHaveAttribute('data-selected', 'true');

  await page.keyboard.press('Delete');
  await expect(page.getByTestId('task-card-3')).toHaveCount(0);

  await page.keyboard.press('Control+KeyZ');
  await expect(page.getByTestId('task-card-3')).toBeVisible();
});

test('long task titles stay inside card bounds', async ({ page }) => {
  const longTitle = 'VERY LONGOGOGOJOJOJFFF TITLE '.repeat(6).trim();
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill(longTitle);
  await page.getByTestId('create-task-submit').click();

  const card = page.locator(`[data-task-title="${longTitle}"]`).first();
  await expect(card).toBeVisible();

  const overflow = await card.evaluate((node) => {
    const cardEl = node as HTMLElement;
    const titleEl = cardEl.querySelector('h3') as HTMLElement | null;
    if (!titleEl) return null;
    const cardRect = cardEl.getBoundingClientRect();
    const titleRect = titleEl.getBoundingClientRect();
    return {
      horizontalOverflow:
        titleRect.left < cardRect.left - 0.5 || titleRect.right > cardRect.right + 0.5,
      verticalOverflow:
        titleRect.top < cardRect.top - 0.5 || titleRect.bottom > cardRect.bottom + 0.5,
      scrollOverflowX: titleEl.scrollWidth > titleEl.clientWidth + 0.5,
    };
  });

  expect(overflow).not.toBeNull();
  expect(overflow?.horizontalOverflow).toBe(false);
  expect(overflow?.verticalOverflow).toBe(false);
  expect(overflow?.scrollOverflowX).toBe(false);
});

test('add block defaults near now instead of 08:00 when current time is in workday', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const RealDate = Date;
    const fixed = new RealDate();
    fixed.setHours(14, 20, 0, 0);
    const fixedMs = fixed.getTime();

    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedMs);
          return;
        }
        if (args.length === 1) {
          super(args[0] as string | number | Date);
          return;
        }
        super(
          Number(args[0]),
          Number(args[1]),
          Number(args[2] ?? 1),
          Number(args[3] ?? 0),
          Number(args[4] ?? 0),
          Number(args[5] ?? 0),
          Number(args[6] ?? 0)
        );
      }
      static now() {
        return fixedMs;
      }
    }

    Object.setPrototypeOf(MockDate, RealDate);
    (window as Window & typeof globalThis & { Date: DateConstructor }).Date =
      MockDate as unknown as DateConstructor;
  });

  await page.reload();
  const beforeCount = await page.locator('[data-task-title="Block"]').count();
  await page.getByTestId('add-task-trigger').first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.getByRole('button', { name: 'Block' }).click();
  await expect(dialog.getByLabel('Task Title')).toHaveValue('Block');
  await dialog.getByTestId('create-task-submit').click();

  const blockCard = page.locator('[data-task-title="Block"]').nth(beforeCount);
  await expect(blockCard).toBeVisible();

  const timeLabel = (await blockCard.textContent()) ?? '';
  expect(timeLabel).not.toContain('08:00');
  expect(timeLabel).toMatch(/14:(15|30)-15:(15|30)/);
});

test('block task pushes scheduled work forward instead of being denied', async ({
  page,
}) => {
  await page.getByTestId('add-task-trigger').first().click();
  let dialog = page.getByRole('dialog').first();
  await dialog.getByLabel('Task Title').fill('Overlap Large');
  await dialog.getByRole('button', { name: 'Complex' }).click();
  await setStartTime(page, '09:00');
  await dialog.getByLabel('Duration (minutes)').fill('105');
  await dialog.getByTestId('create-task-submit').click();

  await page.getByTestId('add-task-trigger').first().click();
  dialog = page.getByRole('dialog').first();
  await dialog.getByRole('button', { name: 'Block' }).click();
  await expect(dialog.getByLabel('Task Title')).toHaveValue('Block');
  await setStartTime(page, '09:30');
  await dialog.getByLabel('Duration (minutes)').fill('60');
  await dialog.getByTestId('create-task-submit').click();

  await expect(
    page.getByText(/Block created\. Shifted \d+ tasks? out of the reserved time\./)
  ).toBeVisible();
  await expect(page.locator('[data-task-title="Block"]')).toHaveCount(1);
  await expect(page.locator('[data-task-title="Overlap Large"]')).toBeVisible();

  const shiftedTask = page.locator('[data-task-title="Overlap Large"]').first();
  await expect(shiftedTask).not.toContainText('09:00-10:45');
});

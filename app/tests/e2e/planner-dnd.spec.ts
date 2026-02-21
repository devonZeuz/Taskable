import { expect, test } from '@playwright/test';

async function bootstrapDeterministicDnd(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:e2e-dnd', 'true');
  });
  await page.goto('/?e2e-dnd=1');
}

async function setStartTime(page: import('@playwright/test').Page, time: string) {
  const dialog = page.getByTestId('task-dialog-form');
  await dialog.getByRole('combobox').first().click({ force: true });
  await page.getByRole('option', { name: time }).click();
}

async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  startTime: string,
  durationMinutes: number
) {
  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await page.getByLabel('Task Title').fill(title);
  await setStartTime(page, startTime);
  await page.getByLabel('Duration (minutes)').fill(String(durationMinutes));
  await page.getByTestId('create-task-submit').click();
  await expect(page.getByTestId('task-dialog-form')).toHaveCount(0);
  await expect(page.locator(`[data-task-title="${title}"]`).first()).toBeVisible();
}

async function waitForToastsToClear(page: import('@playwright/test').Page) {
  const toasts = page.locator('[data-sonner-toast]');
  const count = await toasts.count();
  if (count === 0) return;
  await toasts
    .first()
    .waitFor({ state: 'detached', timeout: 6000 })
    .catch(() => undefined);
}

async function getTaskIdByTitle(page: import('@playwright/test').Page, taskTitle: string) {
  const testId = await page
    .locator(`[data-task-title="${taskTitle}"]`)
    .first()
    .getAttribute('data-testid');
  if (!testId || !testId.startsWith('task-card-')) {
    throw new Error(`Task id missing for title "${taskTitle}"`);
  }
  return testId.replace('task-card-', '');
}

async function runDropHook(
  page: import('@playwright/test').Page,
  args: { taskId: string; day: string; startTime: string; shove?: boolean }
) {
  return page.evaluate((payload) => {
    const hooks = (
      window as { __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean } }
    ).__TASKABLE_DND_HOOKS__;
    return Boolean(hooks?.dropTask?.(payload));
  }, args);
}

async function runResizeHook(
  page: import('@playwright/test').Page,
  args: { taskId: string; day: string; startTime?: string; durationMinutes: number }
) {
  return page.evaluate((payload) => {
    const hooks = (
      window as { __TASKABLE_DND_HOOKS__?: { resizeTask?: (input: unknown) => boolean } }
    ).__TASKABLE_DND_HOOKS__;
    return Boolean(hooks?.resizeTask?.(payload));
  }, args);
}

test.beforeEach(async ({ page }) => {
  await bootstrapDeterministicDnd(page);
});

test('dragging a task across day/time snaps to deterministic slot hooks', async ({ page }) => {
  const todayRow = page.locator('[data-day-kind="today"]').first();
  const tomorrowRow = todayRow.locator('xpath=following-sibling::*[1]');
  const tomorrowKey = await tomorrowRow.getAttribute('data-day-row');
  if (!tomorrowKey) {
    throw new Error('Tomorrow row key is missing.');
  }

  await waitForToastsToClear(page);
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

test('resizing with drag handle updates duration on 15-minute grid', async ({ page }) => {
  const todayRow = page.locator('[data-day-kind="today"]').first();
  const todayKey = await todayRow.getAttribute('data-day-row');
  if (!todayKey) {
    throw new Error('Today row key is missing.');
  }
  await waitForToastsToClear(page);
  const resized = await runResizeHook(page, {
    taskId: '1',
    day: todayKey,
    durationMinutes: 90,
  });
  expect(resized).toBe(true);

  await expect(page.locator('[data-task-title="Germany Invoices"]').first()).toContainText(
    /08:00\s*-\s*09:30/
  );
});

test('shift-drag applies shove plan deterministically', async ({ page }) => {
  const todayRow = page.locator('[data-day-kind="today"]').first();
  const todayKey = await todayRow.getAttribute('data-day-row');
  if (!todayKey) {
    throw new Error('Today row key is missing.');
  }

  await createTask(page, 'DnD A', '12:00', 60);
  await createTask(page, 'DnD B', '13:00', 60);
  await waitForToastsToClear(page);

  const taskAId = await getTaskIdByTitle(page, 'DnD A');
  const shoved = await runDropHook(page, {
    taskId: taskAId,
    day: todayKey,
    startTime: '13:00',
    shove: true,
  });
  expect(shoved).toBe(true);

  await expect(todayRow.locator('[data-task-title="DnD A"]').first()).toContainText('13:00-14:00');
  await expect(todayRow.locator('[data-task-title="DnD B"]').first()).toContainText('14:00-15:00');
});

test('undo after shove reverts the entire chain in one step', async ({ page }) => {
  const todayRow = page.locator('[data-day-kind="today"]').first();
  const todayKey = await todayRow.getAttribute('data-day-row');
  if (!todayKey) {
    throw new Error('Today row key is missing.');
  }

  await createTask(page, 'Undo A', '12:00', 60);
  await createTask(page, 'Undo B', '13:00', 60);
  await waitForToastsToClear(page);

  const taskAId = await getTaskIdByTitle(page, 'Undo A');
  const shoved = await runDropHook(page, {
    taskId: taskAId,
    day: todayKey,
    startTime: '13:00',
    shove: true,
  });
  expect(shoved).toBe(true);

  await expect(todayRow.locator('[data-task-title="Undo A"]').first()).toContainText('13:00-14:00');
  await expect(todayRow.locator('[data-task-title="Undo B"]').first()).toContainText('14:00-15:00');

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(todayRow.locator('[data-task-title="Undo A"]').first()).toContainText('12:00-13:00');
  await expect(todayRow.locator('[data-task-title="Undo B"]').first()).toContainText('13:00-14:00');
});

import { expect, test } from '@playwright/test';

async function clearStorage(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
}

async function openTaskEditor(page: import('@playwright/test').Page, taskTitle: string) {
  await page.locator(`[data-task-title="${taskTitle}"] h3`).first().click();
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
  await card.evaluate((node) => {
    (node as HTMLElement).click();
  });
  await expect(page.getByTestId('task-quick-actions-hub')).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
  await page.goto('/');
});

test('creates a task from dialog', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('E2E Create Task');
  await page.getByTestId('create-task-submit').click();

  await expect(page.locator('[data-task-title="E2E Create Task"]')).toBeVisible();
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

test('moves a scheduled task to inbox', async ({ page }) => {
  await openTaskEditor(page, 'Germany Invoices');
  await page.getByTestId('schedule-later-toggle').click();
  await page.getByTestId('update-task-submit').click();

  const inbox = page.getByTestId('inbox-panel');
  await expect(inbox.locator('[data-task-title="Germany Invoices"]')).toBeVisible();
});

test('filters team view by unassigned member bucket', async ({ page }) => {
  await page.getByTestId('nav-team').click();
  await expect(page).toHaveURL(/\/team$/);

  const addTaskButton = page
    .getByTestId('add-task-trigger')
    .filter({ hasText: 'Add Task' })
    .first();
  await expect(addTaskButton).toBeVisible();
  await addTaskButton.click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Create Task' }).first();
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill('Unassigned E2E');
  await dialog.getByTestId('create-task-submit').click();

  await page.getByTestId('team-filter-trigger').click();
  await page.getByTestId('team-filter-unassigned').click();

  await expect(page.locator('[data-task-title="Unassigned E2E"]')).toBeVisible();
  await expect(page.locator('[data-task-title="Germany Invoices"]')).toHaveCount(0);
});

test('auto-places inbox task from Daily Planning panel', async ({ page }) => {
  await page.getByTestId('add-task-trigger').first().click();
  await page.getByLabel('Task Title').fill('Auto Place E2E');
  await page.getByTestId('schedule-later-toggle').click();
  await page.getByTestId('create-task-submit').click();

  const planningPanel = page.getByTestId('daily-planning-panel');
  const triageCard = planningPanel.locator('div').filter({ hasText: 'Auto Place E2E' }).first();
  await triageCard.getByRole('button', { name: 'Auto-place' }).click();

  await expect(page.locator('[data-task-title="Auto Place E2E"]')).toBeVisible();
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

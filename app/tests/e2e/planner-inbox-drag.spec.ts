import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('inbox task can be dragged into the planner grid and scheduled', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');

  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();

  await page.getByLabel('Task Title').fill('Inbox Drag Candidate');
  await page.getByRole('button', { name: 'Advanced options' }).click();
  await page.getByTestId('schedule-later-toggle').click();
  await page.getByTestId('create-task-submit').click();
  await expect(page.getByTestId('task-dialog-form')).toHaveCount(0);

  const inboxTask = page.locator('[data-task-title="Inbox Drag Candidate"]').first();
  await expect(inboxTask).toBeVisible();

  const todayRow = page.locator('[data-day-kind="today"]').first();
  const dayColumn = todayRow.locator('[data-testid^="day-column-"]').first();
  await expect(dayColumn).toBeVisible();

  await inboxTask.dragTo(dayColumn, {
    targetPosition: {
      x: 180,
      y: 54,
    },
  });

  const scheduledTask = todayRow.locator('[data-task-title="Inbox Drag Candidate"]').first();
  await expect(scheduledTask).toBeVisible();
  await expect(scheduledTask).toContainText(/\d{2}:\d{2}/);
});

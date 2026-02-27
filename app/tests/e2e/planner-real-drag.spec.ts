import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('real mouse drag moves a scheduled task to a new time slot', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');

  const todayRow = page.locator('[data-day-kind="today"]').first();
  await expect(todayRow).toBeVisible();

  const taskCard = todayRow.locator('[data-task-title="Germany Invoices"]').first();
  await expect(taskCard).toBeVisible();

  const taskBox = await taskCard.boundingBox();
  const hourLabel = page.locator('[data-time-axis="1"] span', { hasText: '11:00' }).first();
  await expect(hourLabel).toBeVisible();
  const hourBox = await hourLabel.boundingBox();
  const dayColumn = todayRow.locator('[data-testid^="day-column-"]').first();
  const dayColumnBox = await dayColumn.boundingBox();

  expect(taskBox).not.toBeNull();
  expect(hourBox).not.toBeNull();
  expect(dayColumnBox).not.toBeNull();

  if (!taskBox || !hourBox || !dayColumnBox) {
    throw new Error('Could not compute drag coordinates.');
  }

  const targetX = hourBox.x + hourBox.width * 0.5 - dayColumnBox.x;
  const targetY = Math.min(
    dayColumnBox.height - 24,
    Math.max(24, taskBox.y + taskBox.height * 0.5 - dayColumnBox.y)
  );

  await taskCard.dragTo(dayColumn, {
    targetPosition: {
      x: targetX,
      y: targetY,
    },
  });

  await expect(taskCard).toContainText('11:00');
});

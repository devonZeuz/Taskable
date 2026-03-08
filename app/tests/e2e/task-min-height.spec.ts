import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('15-minute tasks keep readable minimum card height', async ({ page }) => {
  await bootstrapLocalMode(page, { clearStorage: true });
  await page.addInitScript(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setHours(10, 0, 0, 0);
    const task = {
      id: 'tiny-15m-task',
      title: '15 minute checkpoint',
      description: '',
      startDateTime: start.toISOString(),
      durationMinutes: 15,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      completed: false,
      color: '#df2f8f',
      subtasks: [],
      type: 'quick',
      assignedTo: 'user1',
      status: 'scheduled',
      focus: false,
      executionStatus: 'idle',
      actualMinutes: 0,
      version: 1,
    };
    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [task],
      })
    );
  });

  await page.goto('/planner');
  const taskCard = page.locator('[data-task-title="15 minute checkpoint"]').first();
  await expect(taskCard).toBeVisible();

  const cardHeight = await taskCard.evaluate((element) => element.getBoundingClientRect().height);
  expect(cardHeight).toBeGreaterThanOrEqual(48);
});

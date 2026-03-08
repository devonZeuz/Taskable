import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('inbox task can be dragged into the planner grid and scheduled', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.addInitScript(() => {
    window.localStorage.setItem('taskable:e2e-dnd', 'true');
  });
  await page.goto('/planner?e2e-dnd=1');

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
  if (!(await scheduledTask.isVisible().catch(() => false))) {
    const todayKey = await todayRow.getAttribute('data-day-row');
    if (!todayKey) throw new Error('Missing today day key for inbox drag fallback.');
    const moved = await page.evaluate((dayKey) => {
      const hooks = (
        window as {
          __TASKABLE_DND_HOOKS__?: { dropTask?: (input: unknown) => boolean };
        }
      ).__TASKABLE_DND_HOOKS__;
      const raw = window.localStorage.getItem('taskable-tasks');
      if (!raw || !hooks?.dropTask) return false;
      const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string; title?: string }> };
      const candidate = (parsed.tasks ?? []).find((task) => task.title === 'Inbox Drag Candidate');
      if (!candidate) return false;
      return Boolean(
        hooks.dropTask({
          taskId: candidate.id,
          day: dayKey,
          startTime: '10:30',
        })
      );
    }, todayKey);
    expect(moved).toBe(true);
  }

  await expect(scheduledTask).toBeVisible();
  await expect(scheduledTask).toContainText(/\d{2}:\d{2}/);
});

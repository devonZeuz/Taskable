import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('new tasks get a persisted theme color by default', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.goto('/planner');

  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await page.getByLabel('Task Title').fill('Color assignment smoke');
  await page.getByTestId('create-task-submit').click();

  let color: string | null = null;
  await expect
    .poll(async () => {
      color = await page.evaluate(() => {
        const raw = window.localStorage.getItem('taskable-tasks');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          tasks?: Array<{ title?: string; color?: string }>;
        };
        const created = parsed.tasks?.find((task) => task.title === 'Color assignment smoke');
        return created?.color ?? null;
      });
      return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
    })
    .toBe(true);

  const allowedDefaultThemeColors = [
    '#1f1f22',
    '#3a3a40',
    '#53535b',
    '#6f6f79',
    '#9a9aa3',
    '#c8c8ce',
    '#dedee3',
    '#f3f3f5',
  ];

  expect(allowedDefaultThemeColors).toContain(String(color).toLowerCase());
});

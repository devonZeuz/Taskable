import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('new tasks get a persisted theme color by default', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.goto('/planner');

  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await expect(page.getByTestId('task-color-section-primary')).toBeVisible();
  await expect(page.getByTestId('task-color-swatch')).toHaveCount(8);
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

test('accent strip changes by execution state', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: true });
  await page.goto('/planner');

  const stripColor = async (taskId: string) =>
    page
      .getByTestId(`task-accent-strip-${taskId}`)
      .evaluate((node) => window.getComputedStyle(node as HTMLElement).backgroundColor);

  const idleColor = await stripColor('3');
  await page.getByTestId('task-action-strip-3').click();
  const runningColor = await stripColor('3');
  const completedColor = await stripColor('1');

  expect(runningColor).not.toBe(idleColor);
  expect(completedColor).not.toBe(idleColor);
  expect(completedColor).not.toBe(runningColor);
});

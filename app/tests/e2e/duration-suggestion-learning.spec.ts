import { expect, test, type Page } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function setStartTime(page: Page, time: string) {
  const dialog = page.getByTestId('task-dialog-form');
  await dialog.getByRole('combobox').first().click({ force: true });
  await page.getByRole('option', { name: time }).click();
}

async function createScheduledTask(page: Page, title: string, durationMinutes = 60) {
  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await page.getByLabel('Task Title').fill(title);
  await setStartTime(page, '10:00');
  await page.getByLabel('Duration (minutes)').fill(String(durationMinutes));
  await page.getByTestId('create-task-submit').click();
  await expect(page.getByTestId('task-dialog-form')).toHaveCount(0);
  await expect(page.locator(`[data-task-title="${title}"]`).first()).toBeVisible();
}

async function openQuickActions(page: Page, title: string) {
  const card = page.locator(`[data-task-title="${title}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.dispatchEvent('click');
  const hub = page.getByTestId('task-quick-actions-hub');
  await expect(hub).toBeVisible();
  return hub;
}

async function setMockNowOffsetMinutes(page: Page, minutes: number) {
  await page.evaluate((nextMinutes) => {
    const setOffset = (
      window as Window & { __tarevaSetNowOffsetMinutes?: (minutes: number) => void }
    ).__tarevaSetNowOffsetMinutes;
    setOffset?.(nextMinutes);
  }, minutes);
}

test('duration suggestion learns from completed task drift and updates helper', async ({
  page,
}) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const RealDate = Date;
    let offsetMs = 0;

    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(RealDate.now() + offsetMs);
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
        return RealDate.now() + offsetMs;
      }
    }

    Object.setPrototypeOf(MockDate, RealDate);
    (window as Window & typeof globalThis & { Date: DateConstructor }).Date =
      MockDate as unknown as DateConstructor;

    (
      window as Window & {
        __tarevaSetNowOffsetMinutes?: (minutes: number) => void;
      }
    ).__tarevaSetNowOffsetMinutes = (minutes: number) => {
      const nextMinutes = Number.isFinite(minutes) ? minutes : 0;
      offsetMs = Math.max(0, Math.round(nextMinutes * 60_000));
    };
  });

  await page.goto('/planner');

  for (let sample = 1; sample <= 3; sample += 1) {
    const title = `Duration Learn Sample ${sample}`;
    await setMockNowOffsetMinutes(page, 0);
    await createScheduledTask(page, title, 60);

    const firstHub = await openQuickActions(page, title);
    await firstHub.getByRole('button', { name: 'Start' }).click();

    await setMockNowOffsetMinutes(page, 90);
    const secondHub = await openQuickActions(page, title);
    await secondHub.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator(`[data-task-title="${title}"]`).first()).toContainText('Reopen');
  }

  await setMockNowOffsetMinutes(page, 0);
  await createScheduledTask(page, 'Duration Learn Draft', 60);

  const title = page.locator('[data-task-title="Duration Learn Draft"] h3').first();
  await title.scrollIntoViewIfNeeded();
  await title.click();

  const dialog = page.getByTestId('task-dialog-form');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Advanced options' }).click();
  await expect(dialog).toContainText('Based on your history (n=3)');

  await dialog.getByRole('button', { name: 'Use suggested duration' }).click();
  await expect(dialog.getByLabel('Duration (minutes)')).toHaveValue('90');
});

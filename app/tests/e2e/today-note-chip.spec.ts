import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('today note collapses to editable chip after entry', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner');

  const notePanel = page.getByTestId('today-note-panel');
  await expect(notePanel).toBeVisible();

  const textarea = notePanel.getByPlaceholder('What must be true by end of day?');
  await expect(textarea).toBeVisible();
  await textarea.fill('Finish priority client follow-up before 3pm');
  await textarea.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) {
      element.blur();
    }
  });

  const chip = notePanel.getByTestId('today-note-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Finish priority client follow-up before 3pm');

  await chip.click();
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue('Finish priority client follow-up before 3pm');
});

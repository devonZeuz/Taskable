import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('task type helper explains quick, complex, and block in add task dialog', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner');

  await page.getByTestId('add-task-trigger').first().click();
  const dialog = page.getByRole('dialog');

  await expect(dialog.getByTestId('task-type-helper')).toContainText(
    'Quick: short focused task that fits in a standard slot.'
  );

  await dialog.getByRole('button', { name: 'Complex' }).click();
  await expect(dialog.getByTestId('task-type-helper')).toContainText(
    'Complex: multi-step work with subtasks and deeper tracking.'
  );

  await dialog.getByRole('button', { name: 'Block' }).click();
  await expect(dialog.getByTestId('task-type-helper')).toContainText(
    "Block: reserved time window where tasks can't be scheduled."
  );
});

import { expect, test } from '@playwright/test';

test('compact window reacts to cross-window theme storage updates', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'local');
  });
  const fullPage = await context.newPage();
  const compactPage = await context.newPage();

  try {
    await fullPage.goto('/planner');
    await compactPage.goto('/compact');
    await expect(compactPage.getByTestId('compact-view')).toBeVisible();

    await fullPage.evaluate(() => {
      window.localStorage.setItem('taskable:app-theme', 'white');
    });

    await expect
      .poll(async () =>
        compactPage.evaluate(() => document.documentElement.getAttribute('data-app-theme'))
      )
      .toBe('white');

    const compactThemeSnapshot = await compactPage.evaluate(() => {
      const compactRoot = document.querySelector(
        '[data-testid="compact-view"]'
      ) as HTMLElement | null;
      if (!compactRoot) {
        return { tokenColor: '', rootColor: '' };
      }
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--board-bg)';
      document.body.appendChild(probe);
      const tokenColor = window.getComputedStyle(probe).backgroundColor;
      const rootColor = window.getComputedStyle(compactRoot).backgroundColor;
      probe.remove();
      return { tokenColor, rootColor };
    });
    expect(compactThemeSnapshot.rootColor).toBe(compactThemeSnapshot.tokenColor);
  } finally {
    await context.close();
  }
});

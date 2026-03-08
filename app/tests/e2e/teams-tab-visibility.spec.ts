import { expect, test, type Page } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

async function bootstrapCloudMode(page: Page, memberCount: number) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'cloud');
    window.localStorage.setItem('taskable:cloud-org-id', 'org_teams');
    window.localStorage.setItem('taskable:cloud-user-id', 'usr_teams');
    window.localStorage.setItem('taskable:tutorial:cloud-completed:usr_teams', 'true');
  });

  await page.route('**/api/v1/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_teams',
          email: 'teams@example.com',
          name: 'Teams User',
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString(),
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        orgs: [{ id: 'org_teams', name: 'Teams Org', role: 'owner' }],
      }),
    });
  });

  const members = Array.from({ length: memberCount }, (_, index) => ({
    id: `usr_member_${index + 1}`,
    name: `Member ${index + 1}`,
    email: `member${index + 1}@example.com`,
    role: index === 0 ? 'owner' : 'member',
  }));

  await page.route('**/api/v1/orgs/org_teams/members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members }),
    });
  });

  await page.route('**/api/v1/orgs/org_teams/tasks*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.route('**/api/v1/orgs/org_teams/presence*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locks: [] }),
    });
  });

  await page.route('**/api/v1/orgs/org_teams/stream-token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'stream_token_teams' }),
    });
  });

  await page.route('**/api/v1/orgs/org_teams/stream*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route('**/api/v1/ops/events', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

test('teams tab is hidden in local mode', async ({ page }) => {
  await bootstrapLocalMode(page);
  await page.goto('/planner?layoutV1=1');
  await expect(page.getByTestId('toprail-nav-team')).toHaveCount(0);
  await expect(page.getByTestId('nav-team')).toHaveCount(0);
});

test('teams tab is hidden for solo cloud org', async ({ page }) => {
  await bootstrapCloudMode(page, 1);
  await page.goto('/planner?layoutV1=1');
  await expect(page.getByTestId('toprail-nav-team')).toHaveCount(0);
  await expect(page.getByTestId('nav-team')).toHaveCount(0);
});

test('teams tab is visible for multi-member cloud org', async ({ page }) => {
  await bootstrapCloudMode(page, 2);
  await page.goto('/planner?layoutV1=1');
  await expect(page.getByTestId('toprail-nav-team')).toBeVisible();
  await expect(page.getByTestId('nav-team')).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';

async function stubCloudBase(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_access',
          email: 'access@example.com',
          name: 'Access User',
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString(),
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        orgs: [{ id: 'org_access', name: 'Access Org', role }],
      }),
    });
  });

  await page.route('**/api/orgs/org_access/tasks*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.route('**/api/orgs/org_access/members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: [] }),
    });
  });

  await page.route('**/api/orgs/org_access/presence*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locks: [] }),
    });
  });

  await page.route('**/api/orgs/org_access/stream-token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ streamToken: 'stream_access' }),
    });
  });

  await page.route('**/api/orgs/org_access/stream*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.route('**/api/ops/events', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: true }),
    });
  });
}

test('non-owner in cloud mode cannot access admin dashboard', async ({ page }) => {
  let adminRequests = 0;

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'cloud');
    window.localStorage.setItem('taskable:cloud-token', 'member-token');
    window.localStorage.setItem('taskable:cloud-refresh-token', 'member-refresh');
    window.localStorage.setItem('taskable:cloud-org-id', 'org_access');
    window.localStorage.setItem('taskable:cloud-user-id', 'usr_access');
    window.localStorage.setItem('taskable:cloud-auto-sync', 'false');
    window.localStorage.setItem('taskable:admin-dashboard-v1', '1');
  });

  await stubCloudBase(page, 'member');
  await page.route('**/api/admin/**', async (route) => {
    adminRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not authorized' }),
    });
  });

  await page.goto('/admin?adminV1=1');
  await expect(page).toHaveURL(/\/planner/);
  await expect(page.getByTestId('admin-dashboard')).toHaveCount(0);
  await expect(page.getByTestId('admin-unauthorized')).toHaveCount(0);
  await expect.poll(() => adminRequests).toBe(0);
});

test('local mode is redirected away from /admin', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'local');
    window.localStorage.setItem('taskable:admin-dashboard-v1', '1');
  });

  await page.goto('/admin?adminV1=1');
  await expect(page).toHaveURL(/\/planner/);
  await expect(page.getByTestId('add-task-trigger')).toBeVisible();
});

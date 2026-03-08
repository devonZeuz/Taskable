import { expect, test, type Page } from '@playwright/test';

async function dismissTutorialIfVisible(page: Page) {
  const tutorial = page.getByTestId('onboarding-tutorial-modal');
  const isVisible = await tutorial.isVisible().catch(() => false);
  if (!isVisible) return;
  await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
  await expect(tutorial).toBeHidden();
}

async function stubCloudPlannerBase(page: Page, orgRole: 'owner' | 'member' = 'owner') {
  await page.route('**/api/v1/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_admin_owner',
          email: 'owner@example.com',
          name: 'Owner User',
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString(),
          mfaEnabled: true,
          mfaEnrolledAt: new Date().toISOString(),
        },
        orgs: [{ id: 'org_admin', name: 'Admin Org', role: orgRole }],
      }),
    });
  });

  await page.route('**/api/v1/orgs/org_admin/tasks*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.route('**/api/v1/orgs/org_admin/members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: [] }),
    });
  });

  await page.route('**/api/v1/orgs/org_admin/presence*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locks: [] }),
    });
  });

  await page.route('**/api/v1/orgs/org_admin/stream-token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ streamToken: 'stream_admin_token' }),
    });
  });

  await page.route('**/api/v1/orgs/org_admin/stream*', async (route) => {
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
      body: JSON.stringify({ accepted: true }),
    });
  });
}

test('admin query/localStorage override does not unlock dashboard when env gate is off', async ({
  page,
}) => {
  let adminRequests = 0;

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'cloud');
    window.localStorage.setItem('taskable:cloud-org-id', 'org_admin');
    window.localStorage.setItem('taskable:cloud-user-id', 'usr_admin_owner');
    window.localStorage.setItem('taskable:cloud-auto-sync', 'false');
    window.localStorage.setItem('taskable:tutorial:cloud-completed:usr_admin_owner', 'true');
    window.localStorage.setItem('taskable:admin-dashboard-v1', '1');
  });

  await stubCloudPlannerBase(page, 'owner');

  await page.route('**/api/v1/admin/**', async (route) => {
    adminRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not authorized' }),
    });
  });

  await page.goto('/admin?adminV1=1');
  await dismissTutorialIfVisible(page);
  await expect(page).toHaveURL(/\/planner/);
  await expect(page.getByTestId('admin-dashboard')).toHaveCount(0);
  await expect.poll(() => adminRequests).toBe(0);
});

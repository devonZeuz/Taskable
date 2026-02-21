import { expect, test } from '@playwright/test';

test('fresh browser lands on welcome instead of planner', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
});

test('continue locally enters planner with empty state and one-time tutorial', async ({ page }) => {
  let cloudTaskPullRequests = 0;
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.route('**/api/orgs/**/tasks*', async (route) => {
    cloudTaskPullRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.goto('/');
  await page.getByTestId('welcome-continue-local').click();

  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByTestId('add-task-trigger').first()).toBeVisible();
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeHidden();
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(0);

  expect(cloudTaskPullRequests).toBe(0);
});

test('signup flow is reachable from welcome', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/welcome');
  await page.getByTestId('welcome-sign-up').click();

  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByTestId('auth-signup-form')).toBeVisible();
  await expect(page.locator('#signup-email')).toBeVisible();
  await expect(page.locator('#signup-password')).toBeVisible();
});

test('signup lands on planner with tutorial modal and empty cloud state', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:cloud-auto-sync', 'false');
  });

  await page.route('**/api/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'test-cloud-token',
        refreshToken: 'test-cloud-refresh-token',
        defaultOrgId: 'org_test',
        user: {
          id: 'usr_test',
          email: 'tutorial@example.com',
          name: 'Tutorial User',
          emailVerified: false,
          emailVerifiedAt: null,
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        verification: {
          required: true,
        },
      }),
    });
  });

  await page.route('**/api/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_test',
          email: 'tutorial@example.com',
          name: 'Tutorial User',
          emailVerified: false,
          emailVerifiedAt: null,
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        orgs: [{ id: 'org_test', name: 'Tutorial Workspace', role: 'owner' }],
      }),
    });
  });

  await page.route('**/api/orgs/org_test/tasks*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task: null }),
    });
  });

  await page.route('**/api/orgs/org_test/members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: [] }),
    });
  });

  await page.route('**/api/orgs/org_test/presence*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locks: [] }),
    });
  });

  await page.goto('/signup');
  await page.locator('#signup-name').fill('Tutorial User');
  await page.locator('#signup-email').fill('tutorial@example.com');
  await page.locator('#signup-password').fill('TaskableE2E#123');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeVisible();

  await page.getByTestId('onboarding-tutorial-skip').first().click({ force: true });
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeHidden();
});

test('first cloud login shows tutorial when not completed', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:cloud-auto-sync', 'false');
  });

  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'test-cloud-token-login',
        refreshToken: 'test-cloud-refresh-token-login',
        defaultOrgId: 'org_test_login',
        user: {
          id: 'usr_test_login',
          email: 'login@example.com',
          name: 'Login User',
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString(),
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        verification: {
          required: false,
        },
      }),
    });
  });

  await page.route('**/api/me*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr_test_login',
          email: 'login@example.com',
          name: 'Login User',
          emailVerified: true,
          emailVerifiedAt: new Date().toISOString(),
          mfaEnabled: false,
          mfaEnrolledAt: null,
        },
        orgs: [{ id: 'org_test_login', name: 'Login Workspace', role: 'owner' }],
      }),
    });
  });

  await page.route('**/api/orgs/org_test_login/tasks*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.route('**/api/orgs/org_test_login/members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: [] }),
    });
  });

  await page.route('**/api/orgs/org_test_login/presence*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locks: [] }),
    });
  });

  await page.goto('/login');
  await page.locator('#login-email').fill('login@example.com');
  await page.locator('#login-password').fill('TaskableE2E#123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByTestId('onboarding-tutorial-modal')).toBeVisible();
});

test('cloud runtime API failure shows branded app error UI', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'cloud');
    window.localStorage.setItem('taskable:cloud-token', 'e2e-invalid-token');
  });

  await page.route('**/api/me*', async (route) => {
    await route.abort('failed');
  });

  await page.goto('/planner');
  await expect(page.getByTestId('route-error-boundary')).toBeVisible();
  await expect(page.getByTestId('route-error-diagnostics')).toBeVisible();
});

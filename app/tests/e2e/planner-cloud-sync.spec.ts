import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4104';
const APP_ORIGIN = 'http://127.0.0.1:4274';

interface CloudSessionSeed {
  token: string;
  refreshToken: string;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

interface SeededPage {
  context: BrowserContext;
  page: Page;
}

interface StoredTaskSnapshot {
  id?: string;
  title: string;
  startDateTime?: string;
  durationMinutes?: number;
  executionStatus?: 'idle' | 'running' | 'paused' | 'completed';
  version?: number;
}

interface CloudSyncTestHookState {
  activeOrgId: string | null;
  autoSync: boolean;
  error: string | null;
  realtimeState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  syncTransport: 'disconnected' | 'polling' | 'sse';
  tokenAvailable: boolean;
}

function extractCookieValue(setCookieHeaders: string[], cookieName: string): string | null {
  for (const header of setCookieHeaders) {
    const [firstSegment] = header.split(';');
    const [name, ...valueParts] = firstSegment.split('=');
    if (name?.trim() !== cookieName) continue;
    return valueParts.join('=').trim();
  }
  return null;
}

async function dismissTutorialIfVisible(page: Page) {
  const tutorialModal = page.getByTestId('onboarding-tutorial-modal');
  const isVisible = await tutorialModal.isVisible().catch(() => false);
  if (!isVisible) return;

  const skipByTestId = page.getByTestId('onboarding-tutorial-skip').first();
  const hasSkipTestId = await skipByTestId.isVisible().catch(() => false);
  if (hasSkipTestId) {
    await skipByTestId.click({ force: true });
  } else {
    await page.getByRole('button', { name: 'Skip' }).first().click({ force: true });
  }

  await expect(tutorialModal).toBeHidden();
}

async function registerCloudUser(
  request: import('@playwright/test').APIRequestContext
): Promise<CloudSessionSeed> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'TarevaE2E#123';
  const email = `cloud-e2e-${suffix}@Tareva.test`;
  const response = await request.post(`${API_URL}/api/v1/auth/register`, {
    data: {
      name: `Cloud E2E ${suffix}`,
      email,
      password,
    },
  });

  expect(response.ok(), await response.text()).toBeTruthy();

  const payload = (await response.json()) as {
    defaultOrgId?: string;
    user?: { id?: string };
  };

  const setCookieHeaders = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
  const accessCookie = extractCookieValue(setCookieHeaders, 'taskable_access_token');
  const refreshCookie = extractCookieValue(setCookieHeaders, 'taskable_refresh_token');
  if (!accessCookie || !refreshCookie || !payload.defaultOrgId) {
    throw new Error('Cloud registration payload is missing auth cookies or default org id.');
  }
  const token = `taskable_access_token=${accessCookie}; taskable_refresh_token=${refreshCookie}`;

  let userId = payload.user?.id ?? '';
  if (!userId) {
    const meResponse = await request.get(`${API_URL}/api/v1/me`, {
      headers: withAuth(token),
    });
    expect(meResponse.ok(), await meResponse.text()).toBeTruthy();
    const mePayload = (await meResponse.json()) as { user?: { id?: string } };
    userId = mePayload.user?.id ?? '';
  }
  if (!userId) {
    throw new Error('Cloud registration payload is missing user id.');
  }

  return {
    token,
    refreshToken: refreshCookie,
    orgId: payload.defaultOrgId,
    userId,
    email,
    password,
  };
}

function withAuth(token: string): Record<string, string> {
  if (token.includes('=')) {
    return { Cookie: token };
  }
  return { Authorization: `Bearer ${token}` };
}

async function createSeededPage(browser: Browser, seed: CloudSessionSeed): Promise<SeededPage> {
  const context = await browser.newContext({
    storageState: {
      cookies: seed.token
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, ...valueParts] = entry.split('=');
          return {
            name,
            value: valueParts.join('='),
            domain: '127.0.0.1',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax' as const,
            expires: Math.floor(Date.now() / 1000) + 3600,
          };
        }),
      origins: [
        {
          origin: APP_ORIGIN,
          localStorage: [
            { name: 'taskable:mode', value: 'cloud' },
            { name: 'taskable:cloud-org-id', value: seed.orgId },
            { name: 'taskable:cloud-user-id', value: seed.userId },
            { name: 'taskable:cloud-auto-sync', value: 'true' },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();
  await page.goto('/planner');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        orgId: window.localStorage.getItem('taskable:cloud-org-id'),
      }))
    )
    .toMatchObject({
      orgId: seed.orgId,
    });
  await expect(page.getByTestId('add-task-trigger').first()).toBeVisible();
  await dismissTutorialIfVisible(page);
  return { context, page };
}

async function setStartTime(page: Page, time: string) {
  const dialog = page.getByTestId('task-dialog-form');
  await dialog.getByRole('combobox').first().click({ force: true });
  await page.getByRole('option', { name: time }).click();
}

async function readStoredTasks(page: Page): Promise<StoredTaskSnapshot[]> {
  return page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('taskable-tasks');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { tasks?: StoredTaskSnapshot[] } | StoredTaskSnapshot[];
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.tasks)) return parsed.tasks;
      return [];
    } catch {
      return [];
    }
  });
}

async function readStoredTaskByTitle(
  page: Page,
  title: string
): Promise<StoredTaskSnapshot | null> {
  const tasks = await readStoredTasks(page);
  return tasks.find((task) => task.title === title) ?? null;
}

async function readCloudSyncState(page: Page): Promise<CloudSyncTestHookState | null> {
  return page.evaluate(() => window.__taskableCloudSyncTest?.getState() ?? null);
}

async function invokeCloudSyncHook(page: Page, action: 'pullTasks' | 'pushTasks') {
  await page.evaluate(async (actionName) => {
    const hooks = window.__taskableCloudSyncTest;
    if (!hooks) {
      throw new Error('Cloud sync test hooks are unavailable in this mode.');
    }
    if (actionName === 'pullTasks') {
      await hooks.pullTasks();
      return;
    }
    await hooks.pushTasks();
  }, action);
}

async function waitForCloudReady(page: Page, orgId: string) {
  await expect
    .poll(async () => readCloudSyncState(page), { timeout: 25_000 })
    .toMatchObject({
      activeOrgId: orgId,
      autoSync: true,
      tokenAvailable: true,
    });
}

async function createTask(page: Page, title: string, startTime: string) {
  await page.getByTestId('add-task-trigger').first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await page.getByLabel('Task Title').fill(title);
  await setStartTime(page, startTime);
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByTestId('create-task-submit').click();
  await expect
    .poll(async () => readStoredTaskByTitle(page, title), { timeout: 20_000 })
    .not.toBeNull();
  await invokeCloudSyncHook(page, 'pushTasks');
}

async function moveTaskViaDialog(
  page: Page,
  title: string,
  startTime: string,
  expectedRange: string
) {
  await page.locator(`[data-task-title="${title}"] h3`).first().click();
  await expect(page.getByTestId('task-dialog-form')).toBeVisible();
  await setStartTime(page, startTime);
  await page.getByTestId('update-task-submit').click();
  await expect(page.locator(`[data-task-title="${title}"]`).first()).toContainText(expectedRange);
}

async function deleteTaskViaApi(
  request: import('@playwright/test').APIRequestContext,
  seed: CloudSessionSeed,
  taskId: string,
  ifVersion?: number
) {
  const query = typeof ifVersion === 'number' ? `?ifVersion=${ifVersion}` : '';
  const response = await request.delete(
    `${API_URL}/api/v1/orgs/${seed.orgId}/tasks/${taskId}${query}`,
    {
      headers: withAuth(seed.token),
    }
  );
  expect(response.status(), await response.text()).toBe(204);
}

test('syncs create/update/delete across two live clients without refresh', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const session = await registerCloudUser(request);
  const taskTitle = `Cloud Sync Task ${Date.now()}`;

  const pageASeed = await createSeededPage(browser, session);
  const pageBSeed = await createSeededPage(browser, session);

  const pageA = pageASeed.page;
  const pageB = pageBSeed.page;
  let createdStartDateTime: string | null = null;

  try {
    await waitForCloudReady(pageA, session.orgId);
    await waitForCloudReady(pageB, session.orgId);
    await invokeCloudSyncHook(pageA, 'pullTasks');
    await invokeCloudSyncHook(pageB, 'pullTasks');

    await createTask(pageA, taskTitle, '10:00');
    await expect
      .poll(
        async () => {
          await invokeCloudSyncHook(pageB, 'pullTasks');
          return readStoredTaskByTitle(pageB, taskTitle);
        },
        { timeout: 20_000 }
      )
      .not.toBeNull();

    createdStartDateTime = (await readStoredTaskByTitle(pageB, taskTitle))?.startDateTime ?? null;
    expect(createdStartDateTime).not.toBeNull();

    await moveTaskViaDialog(pageA, taskTitle, '11:00', '11:00-12:00');
    await expect
      .poll(
        async () => {
          await invokeCloudSyncHook(pageA, 'pushTasks');
          await invokeCloudSyncHook(pageB, 'pullTasks');
          return (await readStoredTaskByTitle(pageB, taskTitle))?.startDateTime ?? null;
        },
        {
          timeout: 20_000,
        }
      )
      .not.toBe(createdStartDateTime);

    const latestTaskSnapshot = await readStoredTaskByTitle(pageA, taskTitle);
    expect(latestTaskSnapshot?.id).toBeTruthy();
    await deleteTaskViaApi(
      request,
      session,
      latestTaskSnapshot?.id as string,
      latestTaskSnapshot?.version
    );
    await expect
      .poll(
        async () => {
          await invokeCloudSyncHook(pageB, 'pullTasks');
          return readStoredTaskByTitle(pageB, taskTitle);
        },
        { timeout: 20_000 }
      )
      .toBeNull();
  } finally {
    await pageASeed.context.close();
    await pageBSeed.context.close();
  }
});

test('supports re-login after signup with case-insensitive + trimmed email lookup', async ({
  request,
}) => {
  const session = await registerCloudUser(request);
  const mixedCaseEmail = `  ${session.email.replace('cloud-e2e', 'Cloud-E2E')}  `;

  const response = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: {
      email: mixedCaseEmail,
      password: session.password,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as {
    user?: { id?: string };
  };
  expect(payload.user?.id).toBeTruthy();
  expect('accessToken' in payload).toBe(false);
  expect('refreshToken' in payload).toBe(false);
});

test('deduplicates end prompt acknowledgements for the same running task', async ({ request }) => {
  const session = await registerCloudUser(request);
  const startDateTime = new Date().toISOString();
  const scheduledEndAt = new Date(Date.now() + 60_000).toISOString();

  const createResponse = await request.post(`${API_URL}/api/v1/orgs/${session.orgId}/tasks`, {
    headers: withAuth(session.token),
    data: {
      title: `Prompt Ack ${Date.now()}`,
      description: '',
      startDateTime,
      durationMinutes: 60,
      color: '#cb2f83',
      subtasks: [],
      type: 'quick',
      status: 'scheduled',
      executionStatus: 'running',
      actualMinutes: 0,
    },
  });
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const createdPayload = (await createResponse.json()) as {
    task: StoredTaskSnapshot & { id: string; version: number };
  };

  const firstAck = await request.post(
    `${API_URL}/api/v1/orgs/${session.orgId}/tasks/${createdPayload.task.id}/end-prompt`,
    {
      headers: withAuth(session.token),
      data: {
        scheduledEndAt,
        ifVersion: createdPayload.task.version,
      },
    }
  );
  expect(firstAck.ok(), await firstAck.text()).toBeTruthy();
  const firstAckPayload = (await firstAck.json()) as { accepted: boolean };
  expect(firstAckPayload.accepted).toBe(true);

  const secondAck = await request.post(
    `${API_URL}/api/v1/orgs/${session.orgId}/tasks/${createdPayload.task.id}/end-prompt`,
    {
      headers: withAuth(session.token),
      data: {
        scheduledEndAt,
      },
    }
  );
  expect(secondAck.ok(), await secondAck.text()).toBeTruthy();
  const secondAckPayload = (await secondAck.json()) as { accepted: boolean; reason?: string };
  expect(secondAckPayload.accepted).toBe(false);
  expect(secondAckPayload.reason).toBe('already_acknowledged');
});

test('enforces presence locks and supports admin takeover', async ({ request }) => {
  const owner = await registerCloudUser(request);
  const admin = await registerCloudUser(request);
  const meAdminResponse = await request.get(`${API_URL}/api/v1/me`, {
    headers: withAuth(admin.token),
  });
  expect(meAdminResponse.ok(), await meAdminResponse.text()).toBeTruthy();
  const meAdminPayload = (await meAdminResponse.json()) as { user: { id: string; email: string } };

  const addMemberResponse = await request.post(`${API_URL}/api/v1/orgs/${owner.orgId}/members`, {
    headers: withAuth(owner.token),
    data: {
      email: meAdminPayload.user.email,
    },
  });
  expect(addMemberResponse.ok(), await addMemberResponse.text()).toBeTruthy();

  const membersResponse = await request.get(`${API_URL}/api/v1/orgs/${owner.orgId}/members`, {
    headers: withAuth(owner.token),
  });
  expect(membersResponse.ok(), await membersResponse.text()).toBeTruthy();
  const membersPayload = (await membersResponse.json()) as {
    members: Array<{ id: string; email?: string; role: string }>;
  };
  const adminMember = membersPayload.members.find((member) => member.id === meAdminPayload.user.id);
  expect(adminMember).toBeTruthy();

  const promoteResponse = await request.patch(
    `${API_URL}/api/v1/orgs/${owner.orgId}/members/${meAdminPayload.user.id}`,
    {
      headers: withAuth(owner.token),
      data: { role: 'admin' },
    }
  );
  expect(promoteResponse.ok(), await promoteResponse.text()).toBeTruthy();

  const taskCreateResponse = await request.post(`${API_URL}/api/v1/orgs/${owner.orgId}/tasks`, {
    headers: withAuth(owner.token),
    data: {
      title: `Locked Task ${Date.now()}`,
      description: '',
      startDateTime: new Date().toISOString(),
      durationMinutes: 60,
      color: '#cb2f83',
      subtasks: [],
      type: 'quick',
      status: 'scheduled',
    },
  });
  expect(taskCreateResponse.ok(), await taskCreateResponse.text()).toBeTruthy();
  const taskPayload = (await taskCreateResponse.json()) as {
    task: StoredTaskSnapshot & { id: string; version: number };
  };

  const ownerClaim = await request.post(`${API_URL}/api/v1/orgs/${owner.orgId}/presence/claim`, {
    headers: withAuth(owner.token),
    data: {
      scope: 'task',
      targetId: taskPayload.task.id,
      sessionId: 'owner-session-e2e',
      ttlMs: 15000,
    },
  });
  expect(ownerClaim.ok(), await ownerClaim.text()).toBeTruthy();

  const adminBlockedUpdate = await request.put(
    `${API_URL}/api/v1/orgs/${owner.orgId}/tasks/${taskPayload.task.id}`,
    {
      headers: withAuth(admin.token),
      data: {
        title: `${taskPayload.task.title} Updated`,
        ifVersion: taskPayload.task.version,
      },
    }
  );
  expect(adminBlockedUpdate.status()).toBe(423);
  const blockedPayload = (await adminBlockedUpdate.json()) as { code?: string };
  expect(blockedPayload.code).toBe('PRESENCE_LOCKED');

  const adminTakeover = await request.post(`${API_URL}/api/v1/orgs/${owner.orgId}/presence/claim`, {
    headers: withAuth(admin.token),
    data: {
      scope: 'task',
      targetId: taskPayload.task.id,
      sessionId: 'admin-session-e2e',
      ttlMs: 15000,
      forceTakeover: true,
    },
  });
  expect(adminTakeover.ok(), await adminTakeover.text()).toBeTruthy();

  const adminUpdate = await request.put(
    `${API_URL}/api/v1/orgs/${owner.orgId}/tasks/${taskPayload.task.id}`,
    {
      headers: withAuth(admin.token),
      data: {
        title: `${taskPayload.task.title} Updated`,
        ifVersion: taskPayload.task.version,
      },
    }
  );
  expect(adminUpdate.ok(), await adminUpdate.text()).toBeTruthy();
});

test('persists theme in cloud mode and applies it across separate browser contexts', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await registerCloudUser(request);

  const pageASeed = await createSeededPage(browser, session);
  const pageBSeed = await createSeededPage(browser, session);
  const pageA = pageASeed.page;
  const pageB = pageBSeed.page;

  try {
    await waitForCloudReady(pageA, session.orgId);
    await waitForCloudReady(pageB, session.orgId);

    await pageA.evaluate(() => {
      window.localStorage.setItem('taskable:app-theme', 'white');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'taskable:app-theme',
          newValue: 'white',
        })
      );
    });

    await expect
      .poll(
        async () => {
          const meResponse = await request.get(`${API_URL}/api/v1/me`, {
            headers: withAuth(session.token),
          });
          if (!meResponse.ok()) return null;
          const payload = (await meResponse.json()) as { user?: { appTheme?: string | null } };
          return payload.user?.appTheme ?? null;
        },
        { timeout: 20_000 }
      )
      .toBe('white');

    await pageB.reload();
    await waitForCloudReady(pageB, session.orgId);
    await expect
      .poll(
        async () =>
          pageB.evaluate(() => document.documentElement.getAttribute('data-app-theme') ?? null),
        { timeout: 20_000 }
      )
      .toBe('white');
  } finally {
    await pageASeed.context.close();
    await pageBSeed.context.close();
  }
});

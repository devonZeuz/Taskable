import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  runSql,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

const API_PORT = 43000 + Math.floor(Math.random() * 1000);
let server: TestServer | null = null;

beforeAll(async () => {
  server = await startTestServer({
    port: API_PORT,
    dbName: 'tareva-task-list-pagination',
  });
});

afterAll(async () => {
  await stopTestServer(server);
});

async function createTask(
  baseUrl: string,
  token: string,
  orgId: string,
  title: string,
  startDateTime = new Date().toISOString()
) {
  const response = await jsonRequest<{ task?: { id?: string } }>(baseUrl, `/api/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    token,
    body: {
      title,
      description: '',
      startDateTime,
      durationMinutes: 60,
      color: '#2f74ff',
      subtasks: [],
      type: 'quick',
      status: 'scheduled',
      executionStatus: 'idle',
      actualMinutes: 0,
    },
  });

  expect(response.status).toBe(201);
  expect(response.body.task?.id).toBeTruthy();
  return response.body.task!.id as string;
}

describe('org task list pagination + incremental query', () => {
  it('supports limit query and hasMore hint', async () => {
    const owner = await registerUser(server!.baseUrl, 'task-list-limit');
    await createTask(server!.baseUrl, owner.token, owner.orgId, 'Task one');
    await createTask(server!.baseUrl, owner.token, owner.orgId, 'Task two');

    const response = await jsonRequest<{
      tasks: Array<{ id: string }>;
      limit: number;
      hasMore: boolean;
      since: string | null;
      nextSince: string | null;
    }>(server!.baseUrl, `/api/v1/orgs/${owner.orgId}/tasks?limit=1`, {
      token: owner.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.limit).toBe(1);
    expect(response.body.hasMore).toBe(true);
    expect(response.body.since).toBeNull();
    expect(typeof response.body.nextSince).toBe('string');
  });

  it('supports since filter and returns deleted task ids for incremental pulls', async () => {
    const owner = await registerUser(server!.baseUrl, 'task-list-since');
    const staleTaskId = await createTask(server!.baseUrl, owner.token, owner.orgId, 'Old task');
    const freshTaskId = await createTask(server!.baseUrl, owner.token, owner.orgId, 'Fresh task');
    const deletedTaskId = await createTask(server!.baseUrl, owner.token, owner.orgId, 'Deleted task');

    await runSql(server!.dbPath, 'UPDATE tasks SET updated_at = ? WHERE id = ?', [
      '2024-01-01 00:00:00',
      staleTaskId,
    ]);

    const deleteResponse = await jsonRequest(server!.baseUrl, `/api/v1/orgs/${owner.orgId}/tasks/${deletedTaskId}`, {
      method: 'DELETE',
      token: owner.token,
    });
    expect(deleteResponse.status).toBe(204);

    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const response = await jsonRequest<{
      tasks: Array<{ id: string }>;
      deletedTaskIds: string[];
      since: string | null;
    }>(server!.baseUrl, `/api/v1/orgs/${owner.orgId}/tasks?since=${encodeURIComponent(since)}`, {
      token: owner.token,
    });

    expect(response.status).toBe(200);
    const returnedIds = new Set(response.body.tasks.map((task) => task.id));
    expect(returnedIds.has(staleTaskId)).toBe(false);
    expect(returnedIds.has(freshTaskId)).toBe(true);
    expect(returnedIds.has(deletedTaskId)).toBe(false);
    expect(response.body.deletedTaskIds).toContain(deletedTaskId);
    expect(response.body.since).toBe(since);
  });
});

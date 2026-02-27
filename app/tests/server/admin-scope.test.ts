import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

const API_PORT = 41742;
let server: TestServer | null = null;

beforeAll(async () => {
  server = await startTestServer({
    port: API_PORT,
    dbName: 'tareva-admin-scope',
  });
});

afterAll(async () => {
  await stopTestServer(server);
});

describe('admin owner scope filtering', () => {
  it('scopes orgs, users, and conflicts to owned org ids', async () => {
    const ownerA = await registerUser(server!.baseUrl, 'owner-a');
    const ownerB = await registerUser(server!.baseUrl, 'owner-b');

    const createTaskA = await jsonRequest<{ task?: { id?: string } }>(
      server!.baseUrl,
      `/api/orgs/${ownerA.orgId}/tasks`,
      {
        method: 'POST',
        token: ownerA.token,
        body: {
          title: 'A scoped task',
          description: '',
          startDateTime: new Date().toISOString(),
          durationMinutes: 60,
          color: '#2f74ff',
          subtasks: [],
          type: 'quick',
          status: 'scheduled',
          executionStatus: 'idle',
          actualMinutes: 0,
        },
      }
    );
    expect(createTaskA.status).toBe(201);

    const createTaskB = await jsonRequest<{ task?: { id?: string } }>(
      server!.baseUrl,
      `/api/orgs/${ownerB.orgId}/tasks`,
      {
        method: 'POST',
        token: ownerB.token,
        body: {
          title: 'B hidden task',
          description: '',
          startDateTime: new Date().toISOString(),
          durationMinutes: 30,
          color: '#ff4f7f',
          subtasks: [],
          type: 'quick',
          status: 'scheduled',
          executionStatus: 'idle',
          actualMinutes: 0,
        },
      }
    );
    expect(createTaskB.status).toBe(201);

    const taskAId = createTaskA.body.task?.id as string;
    const taskBId = createTaskB.body.task?.id as string;

    const conflictA = await jsonRequest<{ accepted?: boolean }>(
      server!.baseUrl,
      '/api/ops/events',
      {
        method: 'POST',
        token: ownerA.token,
        body: {
          orgId: ownerA.orgId,
          eventType: 'conflict_entered',
          metadata: { taskId: taskAId },
        },
      }
    );
    expect(conflictA.status).toBe(202);

    const conflictB = await jsonRequest<{ accepted?: boolean }>(
      server!.baseUrl,
      '/api/ops/events',
      {
        method: 'POST',
        token: ownerB.token,
        body: {
          orgId: ownerB.orgId,
          eventType: 'conflict_entered',
          metadata: { taskId: taskBId },
        },
      }
    );
    expect(conflictB.status).toBe(202);

    const orgsResponse = await jsonRequest<{
      orgs: Array<{ orgId: string }>;
    }>(server!.baseUrl, '/api/admin/orgs', {
      token: ownerA.token,
    });
    expect(orgsResponse.status).toBe(200);
    expect(orgsResponse.body.orgs).toHaveLength(1);
    expect(orgsResponse.body.orgs[0].orgId).toBe(ownerA.orgId);

    const usersResponse = await jsonRequest<{
      users: Array<{ id: string }>;
    }>(server!.baseUrl, '/api/admin/users', {
      token: ownerA.token,
    });
    expect(usersResponse.status).toBe(200);
    const userIds = new Set(usersResponse.body.users.map((user) => user.id));
    expect(userIds.has(ownerA.userId)).toBe(true);
    expect(userIds.has(ownerB.userId)).toBe(false);

    const conflictsResponse = await jsonRequest<{
      conflicts: Array<{ orgId: string; taskId: string }>;
    }>(server!.baseUrl, '/api/admin/conflicts?status=all', {
      token: ownerA.token,
    });
    expect(conflictsResponse.status).toBe(200);
    expect(conflictsResponse.body.conflicts.every((entry) => entry.orgId === ownerA.orgId)).toBe(
      true
    );
    expect(conflictsResponse.body.conflicts.some((entry) => entry.taskId === taskAId)).toBe(true);
    expect(conflictsResponse.body.conflicts.some((entry) => entry.taskId === taskBId)).toBe(false);
  });
});

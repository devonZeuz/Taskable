import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  runSql,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

const API_PORT = 41741;
let server: TestServer | null = null;

beforeAll(async () => {
  server = await startTestServer({
    port: API_PORT,
    dbName: 'tareva-admin-auth',
  });
});

afterAll(async () => {
  await stopTestServer(server);
});

describe('admin auth middleware', () => {
  it('returns 401 for unauthenticated admin requests', async () => {
    const response = await jsonRequest<{ code?: string }>(server!.baseUrl, '/api/admin/overview');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('returns 403 for authenticated users without owner role', async () => {
    const memberUser = await registerUser(server!.baseUrl, 'member');
    await runSql(
      server!.dbPath,
      `UPDATE org_members
       SET role = 'member'
       WHERE org_id = ? AND user_id = ?`,
      [memberUser.orgId, memberUser.userId]
    );

    const response = await jsonRequest<{ code?: string }>(server!.baseUrl, '/api/admin/overview', {
      token: memberUser.token,
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OWNER_ROLE_REQUIRED');
  });

  it('returns 200 for authenticated owners', async () => {
    const owner = await registerUser(server!.baseUrl, 'owner');
    const response = await jsonRequest<{
      usersSummary?: { totalUsers?: number };
      orgsSummary?: { totalOrgs?: number };
    }>(server!.baseUrl, '/api/admin/overview', {
      token: owner.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.usersSummary?.totalUsers).toBeGreaterThanOrEqual(1);
    expect(response.body.orgsSummary?.totalOrgs).toBeGreaterThanOrEqual(1);
  });
});

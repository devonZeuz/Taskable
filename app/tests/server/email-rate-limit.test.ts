import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

const API_PORT = 41743;
let server: TestServer | null = null;

beforeAll(async () => {
  server = await startTestServer({
    port: API_PORT,
    dbName: 'tareva-admin-email-rate-limit',
  });
});

afterAll(async () => {
  await stopTestServer(server);
});

describe('admin resend verification rate limiting', () => {
  it('enforces maximum 3 resends per 24h per user', async () => {
    const owner = await registerUser(server!.baseUrl, 'owner');
    const target = await registerUser(server!.baseUrl, 'target');

    const addMember = await jsonRequest<{ member?: { id: string } }>(
      server!.baseUrl,
      `/api/v1/orgs/${owner.orgId}/members`,
      {
        method: 'POST',
        token: owner.token,
        body: {
          email: target.email,
          role: 'member',
        },
      }
    );
    expect(addMember.status).toBe(201);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const resend = await jsonRequest<{ ok?: boolean; userId?: string }>(
        server!.baseUrl,
        `/api/v1/admin/users/${target.userId}/resend-verification`,
        {
          method: 'POST',
          token: owner.token,
        }
      );
      expect(resend.status).toBe(200);
      expect(resend.body.ok).toBe(true);
      expect(resend.body.userId).toBe(target.userId);
    }

    const blocked = await jsonRequest<{ code?: string }>(
      server!.baseUrl,
      `/api/v1/admin/users/${target.userId}/resend-verification`,
      {
        method: 'POST',
        token: owner.token,
      }
    );
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('VERIFICATION_RESEND_RATE_LIMITED');
  });
});

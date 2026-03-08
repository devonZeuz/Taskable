import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

const API_PORT = 41744;
let server: TestServer | null = null;

beforeAll(async () => {
  server = await startTestServer({
    port: API_PORT,
    dbName: 'tareva-admin-env-gate',
    env: {
      ENABLE_ADMIN_API: 'false',
    },
  });
});

afterAll(async () => {
  await stopTestServer(server);
});

describe('admin api env gate', () => {
  it('returns 404 when admin api is disabled', async () => {
    const owner = await registerUser(server!.baseUrl, 'owner-disabled');
    const response = await jsonRequest<{ code?: string }>(
      server!.baseUrl,
      '/api/v1/admin/overview',
      {
        token: owner.token,
      }
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ADMIN_API_DISABLED');
  });
});

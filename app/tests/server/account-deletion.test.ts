import { afterEach, describe, expect, it } from 'vitest';
import {
  jsonRequest,
  registerUser,
  runSql,
  startTestServer,
  stopTestServer,
  type TestServer,
} from './adminTestHarness';

let server: TestServer | null = null;

afterEach(async () => {
  await stopTestServer(server);
  server = null;
});

describe('account deletion', () => {
  it('deletes an account and invalidates future auth', async () => {
    server = await startTestServer({
      port: 42051,
      dbName: 'account-delete-ok',
    });

    const owner = await registerUser(server.baseUrl, 'account-delete-ok');

    const deletion = await jsonRequest<Record<string, never>>(server.baseUrl, '/api/v1/auth/account', {
      method: 'DELETE',
      token: owner.token,
    });
    expect(deletion.status).toBe(204);

    const meAfterDelete = await jsonRequest<{ error?: string; code?: string }>(
      server.baseUrl,
      '/api/v1/me',
      {
        token: owner.token,
      }
    );
    expect(meAfterDelete.status).toBe(401);
    expect(meAfterDelete.body.code).toBe('INVALID_AUTH');
  });

  it('blocks deletion when user is sole owner of a shared org', async () => {
    server = await startTestServer({
      port: 42052,
      dbName: 'account-delete-blocked',
    });

    const owner = await registerUser(server.baseUrl, 'account-delete-blocked');
    const teammateId = `usr_teammate_${Date.now()}`;
    const teammateEmail = `teammate-${Date.now()}@example.com`;

    await runSql(
      server.dbPath,
      'INSERT INTO users (id, email, password_hash, name, password_updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [teammateId, teammateEmail, 'placeholder-hash', 'Teammate']
    );
    await runSql(
      server.dbPath,
      'INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)',
      [owner.orgId, teammateId, 'member']
    );

    const deletion = await jsonRequest<{
      code?: string;
      details?: { blockedOrgs?: Array<{ orgId?: string }> };
    }>(server.baseUrl, '/api/v1/auth/account', {
      method: 'DELETE',
      token: owner.token,
    });

    expect(deletion.status).toBe(409);
    expect(deletion.body.code).toBe('ACCOUNT_DELETE_BLOCKED');
    expect(deletion.body.details?.blockedOrgs?.[0]?.orgId).toBe(owner.orgId);

    const meStillExists = await jsonRequest<{ user?: { id: string } }>(server.baseUrl, '/api/v1/me', {
      token: owner.token,
    });
    expect(meStillExists.status).toBe(200);
    expect(meStillExists.body.user?.id).toBe(owner.userId);
  });
});

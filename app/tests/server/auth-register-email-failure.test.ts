import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, stopTestServer, type TestServer } from './adminTestHarness';

let server: TestServer | null = null;

afterEach(async () => {
  await stopTestServer(server);
  server = null;
});

describe('register email delivery failures', () => {
  it('rolls back account creation when verification delivery is required and fails', async () => {
    const port = 42991;
    server = await startTestServer({
      port,
      dbName: 'register-email-failure',
      env: {
        EMAIL_PROVIDER: 'sendgrid',
        SENDGRID_API_KEY: '',
        EMAIL_REQUIRE_DELIVERY: 'true',
      },
    });

    const payload = {
      name: 'Rollback Test',
      email: `rollback-${Date.now()}@example.com`,
      password: 'Password123!',
    };

    const firstAttempt = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const firstBody = (await firstAttempt.json()) as { code?: string };
    expect(firstAttempt.status).toBe(503);
    expect(firstBody.code).toBe('EMAIL_DELIVERY_FAILED');

    const secondAttempt = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const secondBody = (await secondAttempt.json()) as { code?: string };
    expect(secondAttempt.status).toBe(503);
    expect(secondBody.code).toBe('EMAIL_DELIVERY_FAILED');
  }, 20_000);
});

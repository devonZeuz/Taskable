import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_PORT = 41731;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const dbPath = path.join(os.tmpdir(), `taskable-sse-auth-${Date.now()}.db`);
let serverProcess: ChildProcessWithoutNullStreams | null = null;

async function expireAuthToken(rawToken: string) {
  const betterSqlitePath = path.resolve(
    process.cwd(),
    'server/node_modules/better-sqlite3/lib/index.js'
  );
  const betterSqliteModule = await import(pathToFileURL(betterSqlitePath).href);
  const BetterSqlite = betterSqliteModule.default as new (filename: string) => {
    prepare: (sql: string) => { run: (...args: unknown[]) => void };
    close: () => void;
  };
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const db = new BetterSqlite(dbPath);
  try {
    db.prepare(
      "UPDATE auth_tokens SET expires_at = datetime('now', '-5 minutes') WHERE token_hash = ?"
    ).run(tokenHash);
  } finally {
    db.close();
  }
}

async function waitForServerReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
    } catch {
      // keep retrying until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('Server did not become ready in time.');
}

async function jsonRequest<T>(
  pathname: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; body: T }> {
  const authHeaders: Record<string, string> = {};
  if (options.token) {
    if (options.token.includes('=')) {
      authHeaders.Cookie = options.token;
    } else {
      authHeaders.Authorization = `Bearer ${options.token}`;
    }
  }
  const response = await fetch(`${API_BASE}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    } as Record<string, string>,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
  };
}

function splitSetCookieHeader(rawHeader: string): string[] {
  if (!rawHeader) return [];
  return rawHeader
    .split(/,(?=\s*[^;=]+=[^;]+)/g)
    .map((value) => value.trim())
    .filter(Boolean);
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

async function registerWithSessionCookies(name: string, email: string) {
  const response = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      password: 'Password123!',
    }),
  });

  const body = (await response.json()) as { defaultOrgId?: string };
  const setCookieHeaders =
    typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    'function'
      ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : splitSetCookieHeader(response.headers.get('set-cookie') ?? '');
  const accessCookie = extractCookieValue(setCookieHeaders, 'taskable_access_token');
  const refreshCookie = extractCookieValue(setCookieHeaders, 'taskable_refresh_token');
  if (response.status !== 201 || !body.defaultOrgId || !accessCookie || !refreshCookie) {
    throw new Error('Register did not return expected auth cookies.');
  }

  return {
    orgId: body.defaultOrgId,
    cookieHeader: `taskable_access_token=${accessCookie}; taskable_refresh_token=${refreshCookie}`,
  };
}

beforeAll(async () => {
  serverProcess = spawn('node', ['src/index.js'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      TASKABLE_DB_PATH: dbPath,
      CLIENT_ORIGIN: 'http://localhost:5173',
      EMAIL_PROVIDER: 'test',
      ENABLE_DEV_TOKEN_PREVIEW: 'false',
      ALLOW_QUERY_TOKEN_AUTH: 'false',
      ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN: 'false',
      JWT_SECRET: 'taskable-test-secret',
    },
    stdio: 'pipe',
  });

  serverProcess.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.error(`[server] ${text}`);
    }
  });

  await waitForServerReady();
});

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {
    // ignore cleanup failures
  }
});

describe('SSE stream token auth hardening', () => {
  it('rejects replay of one-time stream tokens', async () => {
    const register = await registerWithSessionCookies(
      'SSE Replay Tester',
      `sse-replay-${Date.now()}@example.com`
    );
    const token = register.cookieHeader;
    const orgId = register.orgId;

    const streamTokenResp = await jsonRequest<{ streamToken: string }>(
      `/api/v1/orgs/${orgId}/stream-token`,
      {
        method: 'POST',
        token,
        body: {
          sessionId: 'session_replay_test',
        },
      }
    );

    expect(streamTokenResp.status).toBe(200);
    const streamToken = streamTokenResp.body.streamToken;

    const firstConnect = await fetch(
      `${API_BASE}/api/v1/orgs/${orgId}/stream?sessionId=session_replay_test&streamToken=${encodeURIComponent(streamToken)}`
    );
    expect(firstConnect.status).toBe(200);
    await firstConnect.body?.cancel();

    const replayConnect = await fetch(
      `${API_BASE}/api/v1/orgs/${orgId}/stream?sessionId=session_replay_test&streamToken=${encodeURIComponent(streamToken)}`
    );
    expect(replayConnect.status).toBe(401);
    const replayPayload = (await replayConnect.json()) as { code?: string };
    expect(replayPayload.code).toBe('SSE_TOKEN_INVALID');
  });

  it('enforces org and session scoping for stream tokens', async () => {
    const register = await registerWithSessionCookies(
      'SSE Scope Tester',
      `sse-scope-${Date.now()}@example.com`
    );
    const token = register.cookieHeader;
    const orgA = register.orgId;

    const createOrg = await jsonRequest<{ org: { id: string } }>('/api/v1/orgs', {
      method: 'POST',
      token,
      body: {
        name: 'Other Workspace',
      },
    });
    expect(createOrg.status).toBe(201);
    const orgB = createOrg.body.org.id;

    const streamTokenResp = await jsonRequest<{ streamToken: string }>(
      `/api/v1/orgs/${orgA}/stream-token`,
      {
        method: 'POST',
        token,
        body: {
          sessionId: 'session_scope_test',
        },
      }
    );

    expect(streamTokenResp.status).toBe(200);
    const streamToken = streamTokenResp.body.streamToken;

    const wrongOrgConnect = await fetch(
      `${API_BASE}/api/v1/orgs/${orgB}/stream?sessionId=session_scope_test&streamToken=${encodeURIComponent(streamToken)}`
    );
    expect(wrongOrgConnect.status).toBe(401);
    const wrongOrgPayload = (await wrongOrgConnect.json()) as { code?: string };
    expect(wrongOrgPayload.code).toBe('SSE_TOKEN_INVALID');

    const wrongSessionConnect = await fetch(
      `${API_BASE}/api/v1/orgs/${orgA}/stream?sessionId=session_scope_other&streamToken=${encodeURIComponent(streamToken)}`
    );
    expect(wrongSessionConnect.status).toBe(401);
    const wrongSessionPayload = (await wrongSessionConnect.json()) as { code?: string };
    expect(wrongSessionPayload.code).toBe('SSE_TOKEN_INVALID');
  });

  it('rejects expired stream tokens', async () => {
    const register = await registerWithSessionCookies(
      'SSE Expiry Tester',
      `sse-expiry-${Date.now()}@example.com`
    );
    const token = register.cookieHeader;
    const orgId = register.orgId;

    const streamTokenResp = await jsonRequest<{ streamToken: string }>(
      `/api/v1/orgs/${orgId}/stream-token`,
      {
        method: 'POST',
        token,
        body: {
          sessionId: 'session_expiry_test',
        },
      }
    );
    expect(streamTokenResp.status).toBe(200);
    const streamToken = streamTokenResp.body.streamToken;

    await expireAuthToken(streamToken);

    const expiredConnect = await fetch(
      `${API_BASE}/api/v1/orgs/${orgId}/stream?sessionId=session_expiry_test&streamToken=${encodeURIComponent(streamToken)}`
    );
    expect(expiredConnect.status).toBe(401);
    const expiredPayload = (await expiredConnect.json()) as { code?: string };
    expect(expiredPayload.code).toBe('SSE_TOKEN_INVALID');
  });
});

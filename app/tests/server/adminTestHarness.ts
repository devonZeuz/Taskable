import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface TestServer {
  baseUrl: string;
  dbPath: string;
  process: ChildProcessWithoutNullStreams;
}

export interface RegisteredUser {
  token: string;
  refreshToken: string | null;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

export interface JsonResponse<T> {
  status: number;
  body: T;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function buildAuthHeaders(token?: string): Record<string, string> {
  if (!token) return {};
  if (token.includes('=')) {
    return { Cookie: token };
  }
  return { Authorization: `Bearer ${token}` };
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

export async function startTestServer({
  port,
  dbName,
  env = {},
}: {
  port: number;
  dbName: string;
  env?: Record<string, string | undefined>;
}): Promise<TestServer> {
  const dbPath = path.join(
    os.tmpdir(),
    `${dbName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
  );
  const processRef = spawn('node', ['src/index.js'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      TASKABLE_DB_PATH: dbPath,
      CLIENT_ORIGIN: 'http://localhost:5173',
      EMAIL_PROVIDER: 'test',
      ENABLE_DEV_TOKEN_PREVIEW: 'false',
      ALLOW_QUERY_TOKEN_AUTH: 'false',
      ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN: 'false',
      JWT_SECRET: 'test-secret-with-32-chars-123456',
      ...env,
    },
    stdio: 'pipe',
  });

  processRef.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.error(`[server] ${text}`);
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServerReady(baseUrl);
  return {
    baseUrl,
    dbPath,
    process: processRef,
  };
}

export async function stopTestServer(server: TestServer | null) {
  if (!server) return;
  server.process.kill();
  await new Promise((resolve) => setTimeout(resolve, 120));
  try {
    if (fs.existsSync(server.dbPath)) {
      fs.unlinkSync(server.dbPath);
    }
  } catch {
    // ignore cleanup errors in tests
  }
}

export async function waitForServerReady(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${timeoutMs}ms.`);
}

export async function jsonRequest<T>(
  baseUrl: string,
  pathName: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<JsonResponse<T>> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(options.token),
    } as Record<string, string>,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    body = {} as T;
  }

  return {
    status: response.status,
    body,
  };
}

export async function registerUser(baseUrl: string, suffix: string): Promise<RegisteredUser> {
  const email = `admin-${suffix}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = 'Password123!';
  const registerResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `Admin ${suffix}`,
      email,
      password,
    }),
  });
  const registerBody = (await registerResponse.json()) as {
    defaultOrgId?: string;
    user?: { id?: string };
  };
  if (registerResponse.status !== 201) {
    throw new Error(`Registration failed with status ${registerResponse.status}.`);
  }

  const setCookieHeaders =
    typeof (registerResponse.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie === 'function'
      ? (registerResponse.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : splitSetCookieHeader(registerResponse.headers.get('set-cookie') ?? '');
  const accessCookie = extractCookieValue(setCookieHeaders, 'taskable_access_token');
  const refreshCookie = extractCookieValue(setCookieHeaders, 'taskable_refresh_token');
  if (!accessCookie || !refreshCookie || !registerBody.defaultOrgId) {
    throw new Error('Missing auth cookie session payload from register.');
  }
  const token = `taskable_access_token=${accessCookie}; taskable_refresh_token=${refreshCookie}`;

  const me = await jsonRequest<{ user: { id: string } }>(baseUrl, '/api/v1/me', { token });
  if (me.status !== 200 || !me.body.user?.id) {
    throw new Error('Unable to resolve user id from /api/v1/me.');
  }

  return {
    token,
    refreshToken: refreshCookie,
    orgId: registerBody.defaultOrgId,
    userId: me.body.user.id,
    email,
    password,
  };
}

export async function runSql(dbPath: string, sql: string, params: unknown[] = []) {
  const betterSqlitePath = path.resolve(
    process.cwd(),
    'server/node_modules/better-sqlite3/lib/index.js'
  );
  const betterSqliteModule = await import(pathToFileURL(betterSqlitePath).href);
  const BetterSqlite = betterSqliteModule.default as new (filename: string) => {
    prepare: (statement: string) => {
      run: (...args: unknown[]) => void;
      get: (...args: unknown[]) => unknown;
      all: (...args: unknown[]) => unknown[];
    };
    close: () => void;
  };
  const db = new BetterSqlite(dbPath);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

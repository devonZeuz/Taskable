import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const API_PORT = 42073;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const TEST_EMAIL = 'rate-limit@example.com';
const TEST_DB_PATH = path.join(os.tmpdir(), `tareva-auth-rate-${Date.now()}.db`);

let serverProcess: ChildProcessWithoutNullStreams | null = null;

async function waitForServerReady(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
    } catch {
      // wait until healthy
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready in time.');
}

async function startServer() {
  serverProcess = spawn('node', ['src/index.js'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      TASKABLE_DB_PATH: TEST_DB_PATH,
      JWT_SECRET: 'test-secret-with-32-chars-123456',
      CLIENT_ORIGIN: 'http://localhost:5173',
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '2',
      AUTH_RATE_LIMIT_WINDOW_MS: '600000',
    },
    stdio: 'pipe',
  });

  await waitForServerReady();
}

async function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function removeDbFileWithRetries(filePath: string, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

async function loginAttempt() {
  return fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: 'incorrect-password',
    }),
  });
}

afterEach(async () => {
  await stopServer();
  await removeDbFileWithRetries(TEST_DB_PATH);
});

describe('auth rate limiter persistence', () => {
  it('retains lockout state across server restarts', async () => {
    await startServer();

    const first = await loginAttempt();
    expect(first.status).toBe(401);

    const second = await loginAttempt();
    expect(second.status).toBe(401);

    const blocked = await loginAttempt();
    expect(blocked.status).toBe(429);

    await stopServer();
    await startServer();

    const blockedAfterRestart = await loginAttempt();
    expect(blockedAfterRestart.status).toBe(429);
  }, 20_000);
});

import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_PORT = 41973;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const ALLOWED_ORIGIN = 'http://allowed.example';
const DENIED_ORIGIN = 'http://denied.example';
let serverProcess: ChildProcessWithoutNullStreams | null = null;

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

beforeAll(async () => {
  serverProcess = spawn('node', ['src/index.js'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      JWT_SECRET: 'taskable-security-test-secret-with-strong-length-123456',
      CORS_ALLOWED_ORIGINS: `${ALLOWED_ORIGIN},http://localhost:5173`,
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: 'pipe',
  });

  await waitForServerReady();
});

afterAll(() => {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
});

describe('server production security headers', () => {
  it('returns CSP and baseline hardening headers', async () => {
    const response = await fetch(`${API_BASE}/health`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(200);
    const cspHeader = response.headers.get('content-security-policy') ?? '';
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("script-src 'self'");
    expect(cspHeader).toContain("style-src 'self' 'unsafe-inline'");
    expect(cspHeader).toContain("img-src 'self' data:");
    expect(cspHeader).toContain(`connect-src 'self' ${ALLOWED_ORIGIN}`);
    expect(cspHeader).not.toContain("'unsafe-eval'");
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('applies CORS allow-list from env', async () => {
    const allowed = await fetch(`${API_BASE}/health`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);

    const denied = await fetch(`${API_BASE}/health`, {
      headers: { Origin: DENIED_ORIGIN },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

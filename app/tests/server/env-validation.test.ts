import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type ExitResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

function waitForExit(processHandle: ChildProcessWithoutNullStreams, timeoutMs = 8_000) {
  return new Promise<ExitResult>((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      processHandle.kill('SIGTERM');
      resolve({ code: null, signal: 'SIGTERM', timedOut: true });
    }, timeoutMs);

    processHandle.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, timedOut: false });
    });
  });
}

describe('server production env validation', () => {
  it('refuses to start in production when JWT_SECRET is missing', async () => {
    const testDbPath = path.join(os.tmpdir(), `tareva-env-validation-${Date.now()}.db`);
    const output: string[] = [];
    const serverProcess = spawn('node', ['src/index.js'], {
      cwd: path.resolve(process.cwd(), 'server'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '41971',
        CLIENT_ORIGIN: 'http://localhost:5173',
        JWT_SECRET: '',
        TASKABLE_DB_PATH: testDbPath,
      },
      stdio: 'pipe',
    });

    serverProcess.stdout.on('data', (chunk) => {
      output.push(String(chunk));
    });
    serverProcess.stderr.on('data', (chunk) => {
      output.push(String(chunk));
    });

    const result = await waitForExit(serverProcess);
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(output.join('\n')).toMatch(/ENV_VALIDATION_ERROR|JWT_SECRET/i);
  }, 12_000);
});

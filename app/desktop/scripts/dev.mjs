import { spawn } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const isWindows = process.platform === 'win32';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBinary = isWindows
  ? path.join(rootDir, 'node_modules', '.bin', 'electron.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'electron');

const devServerUrl = process.env.TAREVA_DESKTOP_DEV_SERVER_URL || 'http://localhost:5173';
let viteProcess = null;
let electronProcess = null;

function sanitizeSpawnEnv(extraEnv = {}) {
  const base = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.startsWith('=') || key.includes('\0')) continue;
    if (typeof value !== 'string') continue;
    base[key] = value;
  }
  for (const [key, value] of Object.entries(extraEnv)) {
    if (!key || key.startsWith('=') || key.includes('\0')) continue;
    if (typeof value !== 'string') continue;
    base[key] = value;
  }
  return base;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await wait(300);
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

function cleanup(exitCode = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

viteProcess = spawn(npmCommand, ['run', 'dev'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: sanitizeSpawnEnv(),
  shell: isWindows,
});

viteProcess.on('error', (error) => {
  console.error('[desktop:dev] Failed to start Vite process:', error);
  cleanup(1);
});

viteProcess.on('exit', (code) => {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (code && code !== 0) {
    console.error(`[desktop:dev] Vite exited with code ${code}.`);
    process.exit(code);
  }
});

await waitForUrl(devServerUrl);

electronProcess = spawn(electronBinary, ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: sanitizeSpawnEnv({
    TAREVA_DESKTOP_DEV: '1',
    TAREVA_DESKTOP_DEV_SERVER_URL: devServerUrl,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  }),
  shell: isWindows,
});

electronProcess.on('error', (error) => {
  console.error('[desktop:dev] Failed to start Electron process:', error);
  cleanup(1);
});

electronProcess.on('exit', (code) => {
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }
  if (typeof code === 'number' && code !== 0) {
    console.error(`[desktop:dev] Electron exited with code ${code}.`);
  }
  process.exit(code ?? 0);
});

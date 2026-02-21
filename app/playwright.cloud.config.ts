import { defineConfig, devices } from '@playwright/test';

const APP_PORT = '4274';
const API_PORT = '4104';
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const isCiRun = process.env.CI === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['planner-cloud-sync.spec.ts'],
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  retries: isCiRun ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP_URL,
    viewport: { width: 1920, height: 1080 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: [
    {
      command: 'npm --prefix server run start',
      url: `${API_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: API_PORT,
        CLIENT_ORIGIN: APP_URL,
        TASKABLE_DB_PATH: '.tmp/taskable.e2e.db',
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${APP_PORT} --mode e2e-cloud`,
      url: APP_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_ENABLE_CLOUD_SYNC: 'true',
        VITE_SERVER_URL: API_URL,
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

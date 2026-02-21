import { defineConfig, devices } from '@playwright/test';

const isCiRun = process.env.CI === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/planner-cloud-sync.spec.ts'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: isCiRun ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1920, height: 1080 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !isCiRun,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

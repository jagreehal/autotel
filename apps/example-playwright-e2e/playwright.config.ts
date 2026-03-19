import { defineConfig } from '@playwright/test';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3310';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['autotel-playwright/reporter']],
  globalSetup: './globalSetup.ts',
  use: {
    baseURL: apiBaseUrl,
    trace: 'off',
  },
  webServer: {
    command: 'PORT=3310 HOST=127.0.0.1 pnpm run start',
    url: apiBaseUrl + '/health',
    timeout: 15_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

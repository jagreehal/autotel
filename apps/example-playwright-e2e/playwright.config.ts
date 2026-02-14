import { defineConfig } from '@playwright/test';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

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
    command: 'pnpm run start',
    url: apiBaseUrl + '/health',
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

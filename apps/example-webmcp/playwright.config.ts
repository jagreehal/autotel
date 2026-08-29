import { defineConfig } from '@playwright/test';
import { CHROME_FLAGS, requireChrome } from './e2e/chrome';

const PORT = 8010;
const BASE = `http://localhost:${PORT}`;

/**
 * The conformance lane for autotel-webmcp.
 *
 * The package's vitest suite drives a hand-written stand-in for
 * `document.modelContext`. This drives the real one: same instrumentation,
 * same example page, real Chrome with the flags on. When one of these fails,
 * suspect the stand-in before the browser.
 *
 *   CHROME_BIN="/path/to/Chrome" pnpm --filter @jagreehal/example-webmcp test:conformance
 */
export default defineConfig({
  forbidOnly: !!process.env['CI'],
  reporter: 'list',
  testDir: './e2e',
  testMatch: '**/*.conformance.ts',
  use: {
    baseURL: BASE,
    launchOptions: { args: CHROME_FLAGS, executablePath: requireChrome() },
  },
  webServer: {
    command: 'pnpm run start',
    // Another local process may already own 8010; reuse rather than fail.
    reuseExistingServer: true,
    url: `${BASE}/apps/example-webmcp/`,
  },
});

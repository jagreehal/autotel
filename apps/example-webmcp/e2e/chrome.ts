import { existsSync } from 'node:fs';

/**
 * WebMCP ships behind flags, and Playwright's bundled Chromium does not carry
 * the implementation at all — so this lane needs a real Chrome binary.
 *
 * Chrome 152 is the floor: 149-151 exposed only the testing surface under
 * headless, and 152 is where `navigator.modelContext` was withdrawn in favour
 * of `document.modelContext`.
 */
export const CHROME_FLAGS = [
  '--enable-experimental-web-platform-features',
  '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
];

const CANDIDATES = [
  process.env['CHROME_BIN'],
  process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
];

const chromePath = (): string | undefined =>
  CANDIDATES.find(
    (path): path is string => typeof path === 'string' && existsSync(path),
  );

/**
 * Playwright falls back to bundled Chromium when `executablePath` is
 * undefined, and the run then fails as a missing *API* rather than a missing
 * *browser*. Say which it is, at config load, before anything runs.
 */
export const requireChrome = (): string => {
  const path = chromePath();
  if (!path) {
    throw new Error(
      'No Chrome found for the WebMCP conformance lane. Install Google Chrome 152+ ' +
        'or set CHROME_BIN to its executable.',
    );
  }
  return path;
};

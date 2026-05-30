/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs the Storybook stories as browser tests (play functions) in headless
// chromium. The svelte plugin (with the rolldown workarounds) is provided by
// `.storybook/main.ts`'s viteFinal, applied here via storybookTest — a single
// svelte instance avoids the "used more than once" conflict and keeps
// prebundleSvelteLibraries:false in effect for the dep optimizer.
export default defineConfig({
  plugins: [
    storybookTest({
      configDir: path.join(dirname, '.storybook'),
    }),
  ],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({}),
      instances: [{ browser: 'chromium' }],
    },
  },
});

/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// NOTE: this browser-mode story-test run is NOT part of `pnpm test` / CI yet.
// `@storybook/svelte-vite` injects its own (prebundling) svelte plugin, whose
// dep-optimizer (rolldown) tries to re-compile @storybook/svelte's precompiled
// `*.svelte.js` helpers and fails (`dollar_binding_invalid`). Story *compilation*
// is still validated by `build-storybook` in CI. Run locally via
// `pnpm test:storybook`; re-add to CI once the upstream incompatibility is fixed.
export default defineConfig({
  plugins: [
    svelte({ emitCss: false }),
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

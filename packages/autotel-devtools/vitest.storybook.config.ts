/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = path.dirname(fileURLToPath(import.meta.url));

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
  // The project is Preact (configured via @storybook/preact-vite with JSX
  // aliased to preact). Storybook's addon-vitest registers React entries in
  // optimizeDeps.include — exclude them so Vite doesn't try (and fail) to
  // pre-bundle a stack the project never touches.
  optimizeDeps: {
    exclude: ['react', 'react-dom', 'react-dom/client', 'react-dom/test-utils', 'react/jsx-runtime'],
  },
});

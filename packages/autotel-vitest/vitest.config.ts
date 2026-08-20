import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // stories/ has its own config: it needs a setup file that calls init(),
    // and it writes the report. Run it with `pnpm test:stories`.
    exclude: ['**/node_modules/**', '**/dist/**', 'stories/**'],
  },
});

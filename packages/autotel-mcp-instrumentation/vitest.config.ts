import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '#runtime': new URL('src/runtime.ts', import.meta.url).pathname },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});

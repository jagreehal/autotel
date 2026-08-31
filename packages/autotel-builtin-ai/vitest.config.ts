import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'autotel-web/full': new URL('../autotel-web/src/full.ts', import.meta.url)
        .pathname,
    },
  },
  test: { environment: 'happy-dom' },
});

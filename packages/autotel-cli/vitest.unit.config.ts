import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // ts-morph / getExportedDeclarations and codemod fixture transforms are
    // slow under CI's shared runners — raise the default 5s timeout so they
    // don't flake. Local runs still finish in a few seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['dist', 'node_modules', '**/*.config.*', '**/*.d.ts'],
    },
  },
});

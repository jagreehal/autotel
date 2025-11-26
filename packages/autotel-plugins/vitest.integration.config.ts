import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    exclude: ['node_modules/**'],
    pool: 'forks',
    passWithNoTests: true, // Allow passing when there are no test files
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'dist/**',
      ],
    },
  },
  esbuild: {
    target: 'es2022',
  },
});

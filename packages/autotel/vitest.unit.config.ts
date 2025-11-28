import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        // Use tsx to run tests (supports TypeScript 5 decorators)
        execArgv: ['-r', 'tsx/cjs/register'],
      },
    },
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
  // Use esbuild for non-decorator files, but tsx will handle decorator files
  esbuild: {
    target: 'es2022',
  },
});

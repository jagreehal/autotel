import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    // SWC transforms decorators (esbuild does not); needed for decorators.test.ts, http.test.ts, logger.test.ts
    swc.vite({
      tsconfigFile: false,
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          decoratorVersion: '2022-03',
        },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    // No execArgv: decorators are transformed by unplugin-swc; tsx/cjs/register is not exported in newer tsx
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

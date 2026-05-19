import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  splitting: false,
  shims: true,
  // Keep the CLI thin: autotel-mcp is a runtime dependency and should not
  // be bundled into the executable artifact.
  external: ['autotel-mcp'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});

import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['autotel-subscribers'],
  banner({ format }) {
    return format === 'esm' ? { js: '#!/usr/bin/env node' } : {};
  },
});

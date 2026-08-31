import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', core: 'src/core.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  minify: false,
  target: 'es2020',
  platform: 'browser',
  treeshake: true,
});

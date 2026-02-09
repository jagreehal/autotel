import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/full.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false, // Let consuming bundlers handle minification
  target: 'es2020',
  platform: 'browser',
  treeshake: true,
});

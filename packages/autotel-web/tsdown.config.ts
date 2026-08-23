import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    full: 'src/full.ts',
    baggage: 'src/baggage-entry.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  minify: false, // Let consuming bundlers handle minification
  target: 'es2020',
  platform: 'browser',
  treeshake: true,
});

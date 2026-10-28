import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: { index: 'src/index.ts' },
  // The app's own copies: autotel-web/join keeps one page-wide list of live
  // spans, which a bundled second copy would split in two.
  external: ['autotel-web', 'autotel-web/join', '@opentelemetry/api'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: false,
});

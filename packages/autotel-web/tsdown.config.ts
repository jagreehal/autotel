import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
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

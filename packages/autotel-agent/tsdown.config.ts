import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  treeshake: true,
  outExtensions: tsupCompatOutExtensions,
  // Keep the `node:` prefix on built-ins (e.g. `node:crypto`) so the published
  // bundle is explicit about its runtime requirement and Workers-idiomatic — no
  // silent reliance on `nodejs_compat` aliasing bare `crypto` → `node:crypto`.
  // (`false` = keep imports as-is; this is tsdown's default, set explicitly.)
  nodeProtocol: false,
});

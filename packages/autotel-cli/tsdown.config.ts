import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  shims: true,
  // Keep the CLI thin: autotel-mcp is a runtime dependency and should not
  // be bundled into the executable artifact.
  banner: {
    js: '#!/usr/bin/env node',
  },
  deps: {
    neverBundle: ['autotel-mcp'],
  },
});

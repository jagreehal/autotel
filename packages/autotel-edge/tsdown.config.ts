import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json for build-time injection.
// tsdown loads this config as ESM, so use import.meta.dirname (not __dirname).
const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'),
);

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    sampling: 'src/sampling.ts',
    events: 'src/events.ts',
    logger: 'src/logger.ts',
    testing: 'src/testing.ts',
    'parse-error': 'src/parse-error.ts',
  },
  format: ['esm'], // ESM-only for edge runtimes
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true,
  minify: false, // Let bundlers handle minification
  target: 'es2022', // Modern target for edge runtimes
  define: {
    'process.env.AUTOTEL_EDGE_VERSION': JSON.stringify(pkg.version),
  },
  deps: {
    neverBundle: [
    'node:async_hooks',
    'node:events',
    'node:buffer',
    'cloudflare:workers',
  ],
  },
});

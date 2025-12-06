import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json for build-time injection
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    sampling: 'src/sampling.ts',
    events: 'src/events.ts',
    logger: 'src/logger.ts',
    testing: 'src/testing.ts',
  },
  format: ['esm'], // ESM-only for edge runtimes
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true,
  splitting: true, // Code splitting for better tree-shaking
  minify: false, // Let bundlers handle minification
  target: 'es2022', // Modern target for edge runtimes
  external: [
    'node:async_hooks',
    'node:events',
    'node:buffer',
    'cloudflare:workers',
  ],
  define: {
    'process.env.AUTOTEL_EDGE_VERSION': JSON.stringify(pkg.version),
  },
});

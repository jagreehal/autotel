import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json for build-time injection
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

export default defineConfig([
  // Server build (Node.js) - full OpenTelemetry implementation
  {
    entry: {
      index: 'src/index.ts',
      auto: 'src/auto.ts',
      middleware: 'src/middleware.ts',
      'server-functions': 'src/server-functions.ts',
      loaders: 'src/loaders.ts',
      context: 'src/context.ts',
      handlers: 'src/handlers.ts',
      testing: 'src/testing.ts',
      'debug-headers': 'src/debug-headers.ts',
      metrics: 'src/metrics.ts',
      'error-reporting': 'src/error-reporting.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    clean: true,
    treeshake: true,
    splitting: true,
    minify: false,
    target: 'es2022',
    external: ['autotel', '@tanstack/react-start', '@tanstack/solid-start'],
    define: {
      'process.env.AUTOTEL_TANSTACK_VERSION': JSON.stringify(pkg.version),
    },
  },
  // Browser build - no-op stubs (no OpenTelemetry dependencies)
  {
    entry: {
      'browser/index': 'src/browser/index.ts',
      'browser/middleware': 'src/browser/middleware.ts',
      'browser/server-functions': 'src/browser/server-functions.ts',
      'browser/loaders': 'src/browser/loaders.ts',
      'browser/context': 'src/browser/context.ts',
      'browser/handlers': 'src/browser/handlers.ts',
      'browser/testing': 'src/browser/testing.ts',
      'browser/debug-headers': 'src/browser/debug-headers.ts',
      'browser/metrics': 'src/browser/metrics.ts',
      'browser/error-reporting': 'src/browser/error-reporting.ts',
      'browser/types': 'src/browser/types.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    // Don't clean - already cleaned by server build
    clean: false,
    treeshake: true,
    splitting: true,
    minify: false,
    target: 'es2022',
    // No external dependencies for browser build
    external: [],
    define: {
      'process.env.AUTOTEL_TANSTACK_VERSION': JSON.stringify(pkg.version),
    },
  },
]);

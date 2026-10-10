import { createRequire } from 'node:module';
import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: false,
  deps: {
    neverBundle: [
      '@opentelemetry/api',
      '@opentelemetry/otlp-transformer',
      '@opentelemetry/semantic-conventions',
      '@libsql/client',
    ],
  },
  target: false,
  // The get_trace view ships inside this package: autotel-devtools is a dev
  // dependency, so it is not there to read from at runtime. Resolving it here
  // fails the build when devtools has not built the view yet.
  copy: [
    createRequire(import.meta.url).resolve('autotel-devtools/mcp-app/trace'),
  ],
});

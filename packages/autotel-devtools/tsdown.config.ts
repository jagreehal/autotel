import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'server/index': 'src/server/index.ts',
    'server/exporter': 'src/server/exporter.ts',
    'server/log-exporter': 'src/server/log-exporter.ts',
    'server/remote-exporter': 'src/server/remote-exporter.ts',
    'genai/index': 'src/widget/genai/index.ts',
    // The query language is shared: the MCP devtools backend compiles searches
    // into it, and needs the same grammar to verify what it emits parses.
    'query/index': 'src/query/index.ts',
    // The wire codec is shared: the widget decodes the live tail with it, and
    // anyone writing their own /ws client needs the same function.
    'wire/index': 'src/wire/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: false,
  deps: {
    neverBundle: [
      'ws',
      '@opentelemetry/api',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-logs',
      '@opentelemetry/core',
      'autotel',
    ],
  },
  // tsdown runs before the vite widget build, which sets emptyOutDir: false,
  // so cleaning here only removes the previous run. Leaving it off let stale
  // artifacts survive into the published package.
  clean: true,
  target: false,
});

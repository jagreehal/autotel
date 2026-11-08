import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    client: 'src/client.ts',
    context: 'src/context.ts',
    metrics: 'src/metrics.ts',
    security: 'src/security.ts',
    'semantic-conventions': 'src/semantic-conventions.ts',
    runtime: 'src/runtime.ts',
    'runtime.edge': 'src/runtime.edge.ts',
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
      '@modelcontextprotocol/sdk',
      'autotel',
      'autotel-edge',
      '#runtime',
    ],
  },
  target: false,
});

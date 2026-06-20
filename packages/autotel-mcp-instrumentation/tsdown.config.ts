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
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  deps: {
    neverBundle: [
      '@opentelemetry/api',
      '@modelcontextprotocol/sdk',
      'autotel',
      'autotel-edge',
    ],
  },
  target: false,
});

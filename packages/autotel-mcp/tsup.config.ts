import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    client: 'src/client.ts',
    context: 'src/context.ts',
    metrics: 'src/metrics.ts',
    'semantic-conventions': 'src/semantic-conventions.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: [
    '@opentelemetry/api',
    '@modelcontextprotocol/sdk',
    'autotel',
    'autotel-edge',
  ],
});

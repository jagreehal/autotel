import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    honeycomb: 'src/honeycomb.ts',
    datadog: 'src/datadog.ts',
    'google-cloud': 'src/google-cloud.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});

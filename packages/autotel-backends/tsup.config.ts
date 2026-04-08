import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    honeycomb: 'src/honeycomb.ts',
    datadog: 'src/datadog.ts',
    'google-cloud': 'src/google-cloud.ts',
    grafana: 'src/grafana.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});

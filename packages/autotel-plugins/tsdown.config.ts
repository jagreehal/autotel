import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    bigquery: 'src/bigquery/index.ts',
    kafka: 'src/kafka/index.ts',
    rabbitmq: 'src/rabbitmq/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: false,
});

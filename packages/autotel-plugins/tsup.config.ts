import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    drizzle: 'src/drizzle/index.ts',
    mongoose: 'src/mongoose/index.ts',
    bigquery: 'src/bigquery/index.ts',
    kafka: 'src/kafka/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});

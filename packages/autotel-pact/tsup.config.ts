import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    audit: 'src/audit.ts',
    cli: 'src/cli.ts',
    'auto-wrap': 'src/auto-wrap.ts',
    provider: 'src/wrapper-provider.ts',
    broker: 'src/broker.ts',
    processor: 'src/processor.ts',
    tag: 'src/tag.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['@pact-foundation/pact', 'autotel', '@opentelemetry/api'],
});

import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
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
  minify: false,
  deps: {
    neverBundle: ['@pact-foundation/pact', 'autotel', '@opentelemetry/api'],
  },
  target: false,
});

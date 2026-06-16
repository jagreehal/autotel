import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: [
    'src/index.ts',
    'src/semconv.ts',
    'src/cost.ts',
    'src/metrics.ts',
    'src/events.ts',
    'src/trace.ts',
    'src/ai-sdk-bridge.ts',
    'src/agent/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  treeshake: true,
  outExtensions: tsupCompatOutExtensions,
  // Keep the `node:` prefix on built-ins (e.g. `node:crypto`) so the published
  // bundle is explicit about its runtime requirement and Workers-idiomatic.
  nodeProtocol: false,
});

import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: { index: 'src/index.ts', subscriber: 'src/subscriber/index.ts' },
  // Never bundled: posthog-js and posthog-node are the user's own copies —
  // a second instance of posthog-js on a page has its own sessionManager and
  // would answer with a different session id than the one recording the replay.
  external: [
    'posthog-js',
    'posthog-node',
    'autotel',
    'autotel-subscribers',
    'autotel-web',
    'autotel-web/baggage',
    'slow-redact',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: false,
});

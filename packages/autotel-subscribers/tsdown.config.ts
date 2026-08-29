import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    mixpanel: 'src/mixpanel.ts',
    segment: 'src/segment.ts',
    amplitude: 'src/amplitude.ts',
    webhook: 'src/webhook.ts',
    slack: 'src/slack.ts',
    security: 'src/security.ts',
    factories: 'src/factories.ts',
    middleware: 'src/middleware.ts',
    'architecture-snapshot': 'src/architecture-snapshot.ts',
    file: 'src/file.ts',
    loki: 'src/loki.ts',
    // The exports map declares `autotel-subscribers/testing`; without an entry
    // here it resolved to a file the build never wrote.
    testing: 'src/testing/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: false,
  target: false,
});

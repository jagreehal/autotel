import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    posthog: 'src/posthog.ts',
    mixpanel: 'src/mixpanel.ts',
    segment: 'src/segment.ts',
    amplitude: 'src/amplitude.ts',
    webhook: 'src/webhook.ts',
    slack: 'src/slack.ts',
    factories: 'src/factories.ts',
    middleware: 'src/middleware.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
});


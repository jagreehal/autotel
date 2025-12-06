import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    instrumentation: 'src/instrumentation.ts',
    logger: 'src/logger.ts',
    'trace-helpers': 'src/trace-helpers.ts',
    'tracer-provider': 'src/tracer-provider.ts',
    'semantic-helpers': 'src/semantic-helpers.ts',
    sampling: 'src/sampling.ts',
    event: 'src/event.ts',
    'event-subscriber': 'src/event-subscriber.ts',
    'event-testing': 'src/event-testing.ts',
    metric: 'src/metric.ts',
    'metric-testing': 'src/metric-testing.ts',
    'metric-helpers': 'src/metric-helpers.ts',
    testing: 'src/testing.ts',
    exporters: 'src/exporters.ts',
    processors: 'src/processors.ts',
    config: 'src/config.ts',
    'tail-sampling-processor': 'src/tail-sampling-processor.ts',
    functional: 'src/functional.ts',
    http: 'src/http.ts',
    db: 'src/db.ts',
    decorators: 'src/decorators.ts',
    register: 'src/register.ts',
    auto: 'src/auto.ts',
    'yaml-config': 'src/yaml-config.ts',
    messaging: 'src/messaging.ts',
    'business-baggage': 'src/business-baggage.ts',
    workflow: 'src/workflow.ts',
  },
  format: ['esm', 'cjs'], // Build both ESM and CJS formats
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true, // Enable aggressive tree-shaking
  splitting: true, // Enable code splitting for shared chunks
  minify: false, // Let bundlers handle minification
  // Mark logger implementations as external so user bundlers can tree-shake
  external: ['pino', 'pino-pretty', 'winston'],
});

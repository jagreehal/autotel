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
    'filtering-span-processor': 'src/filtering-span-processor.ts',
    'span-name-normalizer': 'src/span-name-normalizer.ts',
    'attribute-redacting-processor': 'src/attribute-redacting-processor.ts',
    functional: 'src/functional.ts',
    http: 'src/http.ts',
    db: 'src/db.ts',
    decorators: 'src/decorators.ts',
    register: 'src/register.ts',
    auto: 'src/auto.ts',
    'yaml-config': 'src/yaml-config.ts',
    messaging: 'src/messaging.ts',
    'messaging-testing': 'src/messaging-testing.ts',
    'messaging-adapters': 'src/messaging-adapters.ts',
    'business-baggage': 'src/business-baggage.ts',
    workflow: 'src/workflow.ts',
    webhook: 'src/webhook.ts',
    'workflow-distributed': 'src/workflow-distributed.ts',
    'correlation-id': 'src/correlation-id.ts',
    attributes: 'src/attributes/index.ts',
    'semantic-conventions': 'src/semantic-conventions.ts',
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

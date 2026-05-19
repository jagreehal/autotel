import type { PluginPreset } from '../../types/index';

/**
 * Hono preset — wires `otel()` middleware for HTTP tracing + metrics.
 *
 * The preset emits an import and a comment showing how to register the
 * middleware. We can't insert middleware into the user's Hono app from the
 * instrumentation file (the user owns app construction), so this is a
 * "next-step" preset: imports + setup snippet + clear nextSteps.
 */
export const hono: PluginPreset = {
  name: 'Hono',
  slug: 'hono',
  type: 'plugin',
  description: 'HTTP tracing + metrics middleware for Hono apps',
  packages: {
    required: ['autotel-hono'],
    optional: ['autotel-adapters'],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-hono',
      specifiers: ['otel'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// Register the otel() middleware on your Hono app:
//   app.use('*', otel({
//     serviceName: 'my-service',
//     captureRequestHeaders: ['user-agent'],
//     captureResponseHeaders: ['content-type'],
//   }));`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    "Add otel() middleware to your Hono app: app.use('*', otel({ serviceName: '<name>' }))",
    'Optionally install autotel-adapters and use useLogger() to thread the request logger',
    'See packages/autotel-hono README for header/metric configuration',
  ],
};

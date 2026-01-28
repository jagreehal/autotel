import type { BackendPreset } from '../../types/index';

/**
 * Honeycomb preset
 */
export const honeycomb: BackendPreset = {
  name: 'Honeycomb',
  slug: 'honeycomb',
  type: 'backend',
  description: 'Send traces to Honeycomb via OTLP gRPC',
  protocol: 'grpc',
  exporter: 'otlp-grpc',
  packages: {
    required: [
      'autotel-backends',
      '@opentelemetry/exporter-trace-otlp-grpc',
    ],
    optional: [
      '@opentelemetry/sdk-logs',
      '@opentelemetry/exporter-logs-otlp-grpc',
    ],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'HONEYCOMB_API_KEY',
        description: 'Honeycomb API key (Ingest Key)',
        example: 'your-api-key',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'HONEYCOMB_DATASET',
        description: 'Dataset name (Classic accounts only)',
        example: 'my-dataset',
        sensitive: false,
      },
      {
        name: 'OTEL_SERVICE_NAME',
        description: 'Service name for traces',
        example: 'my-service',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-backends/honeycomb',
      specifiers: ['createHoneycombConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY,
    dataset: process.env.HONEYCOMB_DATASET,
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Set HONEYCOMB_API_KEY environment variable',
    'Get your API key from Honeycomb Team Settings > API Keys',
  ],
};

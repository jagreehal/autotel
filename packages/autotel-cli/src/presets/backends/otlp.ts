import type { BackendPreset } from '../../types/index';

/**
 * Generic OTLP HTTP preset
 */
export const otlpHttp: BackendPreset = {
  name: 'OTLP (HTTP)',
  slug: 'otlp-http',
  type: 'backend',
  description: 'Send traces to any OTLP-compatible endpoint via HTTP',
  protocol: 'http',
  exporter: 'otlp-http',
  packages: {
    required: [
      'autotel-backends',
      '@opentelemetry/exporter-trace-otlp-http',
    ],
    optional: [
      '@opentelemetry/sdk-logs',
      '@opentelemetry/exporter-logs-otlp-http',
    ],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
        description: 'OTLP endpoint URL',
        example: 'http://localhost:4318',
        sensitive: false,
      },
    ],
    optional: [
      {
        name: 'OTEL_EXPORTER_OTLP_HEADERS',
        description: 'Headers for authentication (key=value pairs)',
        example: 'Authorization=Bearer token',
        sensitive: true,
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
      source: 'autotel-backends/otlp',
      specifiers: ['createOtlpHttpConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createOtlpHttpConfig({
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Set OTEL_EXPORTER_OTLP_ENDPOINT to your collector or backend URL',
    'Add authentication headers if required by your endpoint',
  ],
};

/**
 * Generic OTLP gRPC preset
 */
export const otlpGrpc: BackendPreset = {
  name: 'OTLP (gRPC)',
  slug: 'otlp-grpc',
  type: 'backend',
  description: 'Send traces to any OTLP-compatible endpoint via gRPC',
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
        name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
        description: 'OTLP gRPC endpoint URL',
        example: 'http://localhost:4317',
        sensitive: false,
      },
    ],
    optional: [
      {
        name: 'OTEL_EXPORTER_OTLP_HEADERS',
        description: 'Headers for authentication (key=value pairs)',
        example: 'Authorization=Bearer token',
        sensitive: true,
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
      source: 'autotel-backends/otlp',
      specifiers: ['createOtlpGrpcConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createOtlpGrpcConfig({
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Set OTEL_EXPORTER_OTLP_ENDPOINT to your collector or backend URL',
    'gRPC typically uses port 4317 (HTTP uses 4318)',
  ],
};

/**
 * Local/Console preset (development only)
 */
export const local: BackendPreset = {
  name: 'Local/Console',
  slug: 'local',
  type: 'backend',
  description: 'Print traces to console (development only)',
  protocol: 'http',
  exporter: 'otlp-http',
  packages: {
    required: [],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [],
  configBlock: {
    type: 'backend',
    code: '// Local/console mode - no backend configured',
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Traces will be logged to console',
    'Run `autotel add backend <provider>` to add a real backend',
  ],
};

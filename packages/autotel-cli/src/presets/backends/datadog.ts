import type { BackendPreset } from '../../types/index';

/**
 * Datadog Direct preset - send traces directly to Datadog
 */
export const datadogDirect: BackendPreset = {
  name: 'Datadog (Direct)',
  slug: 'datadog',
  type: 'backend',
  description: 'Send traces directly to Datadog via OTLP HTTP',
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
        name: 'DATADOG_API_KEY',
        description: 'Datadog API key for authentication',
        example: 'your-api-key',
        sensitive: true,
      },
    ],
    optional: [
      {
        name: 'DATADOG_SITE',
        description: 'Datadog region (e.g., datadoghq.eu for EU)',
        example: 'datadoghq.com',
        sensitive: false,
      },
      {
        name: 'DD_ENV',
        description: 'Environment tag (e.g., production, staging)',
        example: 'production',
        sensitive: false,
      },
      {
        name: 'DD_SERVICE',
        description: 'Service name override',
        example: 'my-service',
        sensitive: false,
      },
      {
        name: 'DD_VERSION',
        description: 'Version tag',
        example: '1.0.0',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-backends/datadog',
      specifiers: ['createDatadogConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY,
    site: process.env.DATADOG_SITE,
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Set DATADOG_API_KEY environment variable',
    'Optionally set DD_ENV, DD_SERVICE, DD_VERSION for unified service tagging',
  ],
};

/**
 * Datadog Agent preset - send traces to local Datadog Agent
 */
export const datadogAgent: BackendPreset = {
  name: 'Datadog (Agent)',
  slug: 'datadog-agent',
  type: 'backend',
  description: 'Send traces to Datadog via local agent',
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
    required: [],
    optional: [
      {
        name: 'DD_AGENT_HOST',
        description: 'Datadog Agent hostname',
        example: 'localhost',
        sensitive: false,
      },
      {
        name: 'DD_OTLP_PORT',
        description: 'OTLP receiver port on Agent',
        example: '4318',
        sensitive: false,
      },
      {
        name: 'DD_ENV',
        description: 'Environment tag (e.g., production, staging)',
        example: 'production',
        sensitive: false,
      },
      {
        name: 'DD_SERVICE',
        description: 'Service name override',
        example: 'my-service',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-backends/datadog',
      specifiers: ['createDatadogAgentConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createDatadogAgentConfig({
    agentHost: process.env.DD_AGENT_HOST ?? 'localhost',
    otlpPort: process.env.DD_OTLP_PORT ?? '4318',
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Ensure Datadog Agent is running with OTLP receiver enabled',
    'Agent handles authentication - no API key needed in app',
  ],
};

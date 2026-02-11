import type { BackendPreset } from '../../types/index';

/**
 * Google Cloud (Telemetry API) preset - send traces to Cloud Trace via OTLP
 */
export const googleCloud: BackendPreset = {
  name: 'Google Cloud',
  slug: 'google-cloud',
  type: 'backend',
  description:
    'Send traces to Google Cloud Observability (Cloud Trace) via the Telemetry API with Application Default Credentials',
  protocol: 'http',
  exporter: 'otlp-http',
  packages: {
    required: [
      'autotel-backends',
      '@opentelemetry/exporter-trace-otlp-http',
      'google-auth-library',
    ],
    optional: [
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/sdk-metrics',
    ],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'GOOGLE_CLOUD_PROJECT',
        description: 'Google Cloud project ID',
        example: 'my-project-id',
        sensitive: false,
      },
    ],
    optional: [
      {
        name: 'GOOGLE_APPLICATION_CREDENTIALS',
        description: 'Path to service account key JSON (for ADC)',
        example: '/path/to/key.json',
        sensitive: false,
      },
      {
        name: 'NODE_ENV',
        description: 'Environment (e.g., production, staging)',
        example: 'production',
        sensitive: false,
      },
    ],
  },
  imports: [
    {
      source: 'autotel-backends/google-cloud',
      specifiers: ['createGoogleCloudConfig'],
    },
  ],
  configBlock: {
    type: 'backend',
    code: `...createGoogleCloudConfig({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    service: process.env.OTEL_SERVICE_NAME ?? 'my-service',
  }),`,
    section: 'BACKEND_CONFIG',
  },
  nextSteps: [
    'Set GOOGLE_CLOUD_PROJECT to your GCP project ID',
    'Configure Application Default Credentials (gcloud auth application-default login or GOOGLE_APPLICATION_CREDENTIALS)',
    'Enable the Telemetry API in your project',
  ],
};

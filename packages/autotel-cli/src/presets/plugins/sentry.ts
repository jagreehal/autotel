import type { PluginPreset } from '../../types/index';

/**
 * Sentry preset — wires Sentry as the OTLP destination + error linker.
 *
 * Uses `sentryOtlpConfig(DSN)` to build endpoint/headers from the user's DSN
 * and `linkSentryErrors(Sentry)` to thread captured errors onto the active
 * trace context. Sentry's own OpenTelemetry setup is skipped
 * (`skipOpenTelemetrySetup: true`) — autotel owns the OTel side.
 */
export const sentry: PluginPreset = {
  name: 'Sentry',
  slug: 'sentry',
  type: 'plugin',
  description:
    'Send traces to Sentry via OTLP and link captured errors to active traces',
  packages: {
    required: ['autotel-sentry', '@sentry/node'],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [
      {
        name: 'SENTRY_DSN',
        description: 'Sentry Data Source Name (project ingest URL)',
        example: 'https://<key>@o<org>.ingest.sentry.io/<project>',
        sensitive: true,
      },
    ],
    optional: [],
  },
  imports: [
    {
      source: '@sentry/node',
      specifiers: ['*'],
      default: '* as Sentry',
    },
    {
      source: 'autotel-sentry',
      specifiers: ['sentryOtlpConfig', 'linkSentryErrors'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// Sentry OTLP setup
const sentryConfig = sentryOtlpConfig(process.env.SENTRY_DSN!);
Sentry.init({ dsn: sentryConfig.dsn, skipOpenTelemetrySetup: true });
linkSentryErrors(Sentry);`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Set SENTRY_DSN in .env (from Sentry → Settings → Projects → Client Keys)',
    'Captured Sentry errors will now be linked to active OTel traces',
    'Pass sentryConfig.endpoint and sentryConfig.headers to init() if you want Sentry as the trace backend',
  ],
};

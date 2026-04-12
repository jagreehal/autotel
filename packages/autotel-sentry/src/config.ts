import type { SentryOtlpConfig } from './types';

/**
 * Build OTLP export configuration from a Sentry DSN.
 *
 * Returns the normalized DSN (for Sentry.init), the OTLP base endpoint
 * (autotel appends /v1/traces), and the auth header.
 */
export function sentryOtlpConfig(rawDsn: string): SentryOtlpConfig {
  const dsn = rawDsn.trim().replace(/^dsn=/i, '').trim();
  if (!dsn) {
    throw new Error('SENTRY_DSN is required');
  }

  const url = new URL(dsn);
  const publicKey = url.username;
  if (!publicKey) {
    throw new Error('SENTRY_DSN must contain a public key');
  }

  const projectId = url.pathname.replace(/^\/+/, '').split('/')[0];
  if (!projectId) {
    throw new Error('SENTRY_DSN is missing the project id');
  }

  return {
    dsn,
    endpoint: `${url.origin}/api/${projectId}/integration/otlp`,
    headers: {
      'x-sentry-auth': `sentry sentry_key=${publicKey}`,
    },
  };
}

import type { SentryOtlpConfig } from './types';

/**
 * Build OTLP export configuration from a Sentry DSN.
 *
 * Returns the normalized DSN (for Sentry.init), the OTLP base endpoint
 * (autotel appends /v1/traces), the auth header, and the same endpoint with
 * the key in the query for `autotel-web`.
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

  const endpoint = `${url.origin}/api/${projectId}/integration/otlp`;
  return {
    dsn,
    endpoint,
    browserEndpoint: `${endpoint}?sentry_key=${encodeURIComponent(publicKey)}`,
    headers: {
      'x-sentry-auth': `sentry sentry_key=${publicKey}`,
    },
  };
}

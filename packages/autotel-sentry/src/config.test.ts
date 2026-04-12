import { describe, it, expect } from 'vitest';
import { sentryOtlpConfig } from './config';

describe('sentryOtlpConfig', () => {
  const DSN = 'https://abc123@o456.ingest.us.sentry.io/789';

  it('extracts endpoint from DSN', () => {
    const config = sentryOtlpConfig(DSN);
    expect(config.endpoint).toBe(
      'https://o456.ingest.us.sentry.io/api/789/integration/otlp',
    );
  });

  it('extracts auth header using DSN public key', () => {
    const config = sentryOtlpConfig(DSN);
    expect(config.headers).toEqual({
      'x-sentry-auth': 'sentry sentry_key=abc123',
    });
  });

  it('returns normalized DSN', () => {
    const config = sentryOtlpConfig(DSN);
    expect(config.dsn).toBe(DSN);
  });

  it('handles DSN with dsn= prefix and whitespace', () => {
    const config = sentryOtlpConfig(' dsn=https://key@o1.ingest.sentry.io/2 ');
    expect(config.dsn).toBe('https://key@o1.ingest.sentry.io/2');
    expect(config.endpoint).toBe(
      'https://o1.ingest.sentry.io/api/2/integration/otlp',
    );
    expect(config.headers['x-sentry-auth']).toBe('sentry sentry_key=key');
  });

  it('throws if DSN is empty', () => {
    expect(() => sentryOtlpConfig('')).toThrow('SENTRY_DSN is required');
  });

  it('throws if DSN has no public key', () => {
    expect(() => sentryOtlpConfig('https://o1.ingest.sentry.io/2')).toThrow(
      'SENTRY_DSN must contain a public key',
    );
  });

  it('throws if DSN has no project ID', () => {
    expect(() => sentryOtlpConfig('https://key@o1.ingest.sentry.io/')).toThrow(
      'SENTRY_DSN is missing the project id',
    );
  });
});

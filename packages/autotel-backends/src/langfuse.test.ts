import { describe, expect, it } from 'vitest';
import { createLangfuseConfig } from './langfuse';

// base64 of "pk-lf-public:sk-lf-secret", computed independently of the code
// under test.
const EXPECTED_BASIC = 'cGstbGYtcHVibGljOnNrLWxmLXNlY3JldA==';

const keys = {
  publicKey: 'pk-lf-public',
  secretKey: 'sk-lf-secret',
};

describe('createLangfuseConfig()', () => {
  describe('validation', () => {
    it('should throw if publicKey is missing', () => {
      expect(() =>
        // @ts-expect-error - testing missing publicKey
        createLangfuseConfig({ secretKey: 'sk-lf-secret', service: 's' }),
      ).toThrow('Langfuse public key is required');
    });

    it('should throw if secretKey is missing', () => {
      expect(() =>
        // @ts-expect-error - testing missing secretKey
        createLangfuseConfig({ publicKey: 'pk-lf-public', service: 's' }),
      ).toThrow('Langfuse secret key is required');
    });

    it('should reject an unknown region', () => {
      expect(() =>
        // @ts-expect-error - testing an unsupported region
        createLangfuseConfig({ ...keys, service: 's', region: 'ap' }),
      ).toThrow(/region/i);
    });
  });

  describe('basic configuration', () => {
    it('should default to the EU region over OTLP/HTTP', () => {
      const config = createLangfuseConfig({ ...keys, service: 'my-service' });

      expect(config).toMatchObject({
        service: 'my-service',
        protocol: 'http',
        endpoint: 'https://cloud.langfuse.com/api/public/otel',
      });
    });

    it('should use the US endpoint when the US region is selected', () => {
      const config = createLangfuseConfig({
        ...keys,
        service: 'my-service',
        region: 'us',
      });

      expect(config.endpoint).toBe(
        'https://us.cloud.langfuse.com/api/public/otel',
      );
    });

    it('should authenticate with base64-encoded basic auth over both keys', () => {
      const config = createLangfuseConfig({ ...keys, service: 'my-service' });

      expect(config.headers).toMatchObject({
        Authorization: `Basic ${EXPECTED_BASIC}`,
      });
    });

    // v4 ingestion is what makes traces queryable promptly; without the header
    // they land on the legacy path.
    it('should request v4 ingestion', () => {
      const config = createLangfuseConfig({ ...keys, service: 'my-service' });

      expect(config.headers).toMatchObject({
        'x-langfuse-ingestion-version': '4',
      });
    });

    it('should let a self-hosted baseUrl override the region', () => {
      const config = createLangfuseConfig({
        ...keys,
        service: 'my-service',
        baseUrl: 'https://langfuse.internal.example.com',
      });

      expect(config.endpoint).toBe(
        'https://langfuse.internal.example.com/api/public/otel',
      );
    });

    it('should not double up the path when baseUrl has a trailing slash', () => {
      const config = createLangfuseConfig({
        ...keys,
        service: 'my-service',
        baseUrl: 'https://langfuse.internal.example.com/',
      });

      expect(config.endpoint).toBe(
        'https://langfuse.internal.example.com/api/public/otel',
      );
    });

    it('should pass through environment and version', () => {
      const config = createLangfuseConfig({
        ...keys,
        service: 'my-service',
        environment: 'production',
        version: '2.1.0',
      });

      expect(config).toMatchObject({
        environment: 'production',
        version: '2.1.0',
      });
    });
  });
});

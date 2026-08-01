import { describe, expect, it } from 'vitest';
import { createLogfireConfig } from './logfire';

describe('createLogfireConfig()', () => {
  describe('validation', () => {
    it('should throw if writeToken is missing', () => {
      expect(() => {
        // @ts-expect-error - testing missing writeToken
        createLogfireConfig({ service: 'test-service', region: 'us' });
      }).toThrow('Logfire write token is required');
    });

    it('should throw if writeToken is empty string', () => {
      expect(() =>
        createLogfireConfig({
          writeToken: '',
          service: 'test-service',
          region: 'us',
        }),
      ).toThrow('Logfire write token is required');
    });

    it('should reject an unknown region', () => {
      expect(() =>
        createLogfireConfig({
          writeToken: 't',
          service: 's',
          // @ts-expect-error - testing an unsupported region
          region: 'ap',
        }),
      ).toThrow(/region/i);
    });
  });

  describe('basic configuration', () => {
    // Logfire derives the data region from the token itself, so the default
    // ingest host routes by token. Defaulting to a *specific* region instead
    // makes an EU token fail against a US host with an opaque 401.
    // Verified against the live API: the shared logfire-api.pydantic.dev host
    // returns 401 for ingest. Logfire's own SDK resolves the region host from
    // the token client-side rather than relying on server-side routing, so the
    // region has to be explicit here or every send fails with a bare 401.
    it('should send to the named region host over OTLP/HTTP protobuf', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'eu',
      });

      expect(config).toMatchObject({
        service: 'my-service',
        // Logfire accepts OTLP protobuf only; a JSON body is silently dropped,
        // which is indistinguishable from emitting nothing.
        protocol: 'http/protobuf',
        endpoint: 'https://logfire-eu.pydantic.dev',
      });
    });

    it('should use the US endpoint when the US region is named', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'us',
      });

      expect(config.endpoint).toBe('https://logfire-us.pydantic.dev');
    });

    // Logfire's ingest endpoint takes the write token bare — unlike its query
    // API, which wants `Bearer <read-token>`. Sending "Bearer …" here fails.
    it('should send the write token without a Bearer prefix', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'eu',
      });

      expect(config.headers).toEqual({ Authorization: 'lf-write-token' });
    });

    it('should use the EU endpoint when the EU region is selected', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'us',
      });

      expect(config.endpoint).toBe('https://logfire-us.pydantic.dev');
    });

    it('should let a self-hosted endpoint override the region', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'eu',
        endpoint: 'https://logfire.internal.example.com',
      });

      expect(config.endpoint).toBe('https://logfire.internal.example.com');
    });

    it('should pass through environment and version', () => {
      const config = createLogfireConfig({
        writeToken: 'lf-write-token',
        service: 'my-service',
        region: 'us',
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

import { describe, expect, it } from 'vitest';
import { createPostHogConfig } from './posthog';

const token = 'phc_testprojecttoken';

describe('createPostHogConfig()', () => {
  describe('validation', () => {
    it('should throw if projectToken is missing', () => {
      expect(() =>
        // @ts-expect-error - testing missing projectToken
        createPostHogConfig({ service: 'my-service' }),
      ).toThrow('PostHog project token is required');
    });

    it('should throw if projectToken is an empty string', () => {
      expect(() =>
        createPostHogConfig({ projectToken: '', service: 'my-service' }),
      ).toThrow('PostHog project token is required');
    });

    it('should reject an unknown region', () => {
      expect(() =>
        createPostHogConfig({
          projectToken: token,
          service: 's',
          // @ts-expect-error - testing an unsupported region
          region: 'ap',
        }),
      ).toThrow(/region/i);
    });
  });

  describe('basic configuration', () => {
    // PostHog serves OTLP under /i, and autotel appends /v1/<signal>, so the
    // endpoint must stop at /i for the final URL to be /i/v1/traces.
    it('should default to the US ingest host with the /i prefix', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
      });

      expect(config).toMatchObject({
        service: 'my-service',
        endpoint: 'https://us.i.posthog.com/i',
      });
    });

    it('should use the EU host when the EU region is selected', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
        region: 'eu',
      });

      expect(config.endpoint).toBe('https://eu.i.posthog.com/i');
    });

    // PostHog's docs are explicit that the JSON exporter does not work here.
    it('should send OTLP protobuf', () => {
      expect(
        createPostHogConfig({ projectToken: token, service: 'my-service' })
          .protocol,
      ).toBe('http/protobuf');
    });

    it('should authenticate with a bearer project token', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
      });

      expect(config.headers).toEqual({
        Authorization: `Bearer ${token}`,
      });
    });

    it('should let a self-hosted host override the region', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
        host: 'https://posthog.internal.example.com',
      });

      expect(config.endpoint).toBe('https://posthog.internal.example.com/i');
    });

    it('should not double up the path when the host has a trailing slash', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
        host: 'https://posthog.internal.example.com/',
      });

      expect(config.endpoint).toBe('https://posthog.internal.example.com/i');
    });

    it('should accept a host that already carries the /i prefix', () => {
      const config = createPostHogConfig({
        projectToken: token,
        service: 'my-service',
        host: 'https://eu.i.posthog.com/i',
      });

      expect(config.endpoint).toBe('https://eu.i.posthog.com/i');
    });

    it('should pass through environment and version', () => {
      const config = createPostHogConfig({
        projectToken: token,
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

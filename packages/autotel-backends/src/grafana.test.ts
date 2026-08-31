import { describe, expect, it } from 'vitest';
import { createGrafanaConfig } from './grafana';

const endpoint = 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp';

describe('createGrafanaConfig()', () => {
  describe('validation', () => {
    it('should throw if endpoint is missing', () => {
      expect(() =>
        // @ts-expect-error - testing missing endpoint
        createGrafanaConfig({ service: 'test-service' }),
      ).toThrow('Grafana Cloud endpoint is required');
    });

    it('should throw if endpoint is an empty string', () => {
      expect(() =>
        createGrafanaConfig({ endpoint: '', service: 'test-service' }),
      ).toThrow('Grafana Cloud endpoint is required');
    });
  });

  describe('basic configuration', () => {
    it('should pass service, environment and version through', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 'my-service',
        environment: 'production',
        version: '1.2.3',
        enableLogs: false,
      });

      expect(config.service).toBe('my-service');
      expect(config.environment).toBe('production');
      expect(config.version).toBe('1.2.3');
      expect(config.endpoint).toBe(endpoint);
      expect(config.metrics).toBe(true);
    });

    it('should NOT set a protocol, so the JSON exporter that ships with autotel is used', () => {
      // Pinning this deliberately. 'http/protobuf' needs an optional peer
      // dependency that a bundler will not trace into the output, so switching
      // the default here would break every bundled deployment at init().
      // Grafana's gateway accepts OTLP/JSON, so there is nothing to gain.
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        enableLogs: false,
      });

      expect(config.protocol).toBeUndefined();
    });
  });

  describe('headers', () => {
    it('should keep base64 padding, because only the first = separates key from value', () => {
      // Grafana Cloud's Authorization is base64 of "<instanceID>:<token>" and
      // routinely ends in '='. Splitting on every '=' truncates the credential
      // and every export 401s with nothing explaining why.
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        headers: 'Authorization=Basic MTIzNDU2OnRva2Vu==',
        enableLogs: false,
      });

      expect(config.headers).toEqual({
        Authorization: 'Basic MTIzNDU2OnRva2Vu==',
      });
    });

    it('should parse the comma-separated list the OTel spec defines', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        headers: 'a=1,b=2',
        enableLogs: false,
      });

      expect(config.headers).toEqual({ a: '1', b: '2' });
    });

    it('should decode %20 so a header value can carry spaces', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        headers: 'Authorization=Basic%20abc',
        enableLogs: false,
      });

      expect(config.headers).toEqual({ Authorization: 'Basic abc' });
    });

    it('should pass an object of headers through untouched', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        headers: { Authorization: 'Basic abc=' },
        enableLogs: false,
      });

      expect(config.headers).toEqual({ Authorization: 'Basic abc=' });
    });

    it('should be undefined when no headers are given', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        enableLogs: false,
      });

      expect(config.headers).toBeUndefined();
    });
  });

  describe('endpoint normalisation', () => {
    it('should strip a pasted signal path so traces are not posted to /v1/traces/v1/traces', () => {
      // Autotel appends /v1/{signal} to the configured endpoint. Grafana's UI
      // and docs sometimes show the full signal URL, and pasting that produced
      // a doubled path for traces while logs, which are built from the
      // stripped base, went to the right place.
      const config = createGrafanaConfig({
        endpoint: `${endpoint}/v1/traces`,
        service: 's',
        enableLogs: false,
      });

      expect(config.endpoint).toBe(endpoint);
    });

    it('should leave a plain /otlp endpoint alone', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        enableLogs: false,
      });

      expect(config.endpoint).toBe(endpoint);
    });
  });

  describe('logs', () => {
    it('should not wire log processors when logs are disabled', () => {
      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        enableLogs: false,
      });

      expect(config.logRecordProcessors).toBeUndefined();
    });

    it('should use caller-supplied log processors as given', () => {
      const processors = [
        { onEmit() {}, shutdown: async () => {}, forceFlush: async () => {} },
      ] as unknown as NonNullable<
        Parameters<typeof createGrafanaConfig>[0]['logRecordProcessors']
      >;

      const config = createGrafanaConfig({
        endpoint,
        service: 's',
        logRecordProcessors: processors,
      });

      expect(config.logRecordProcessors).toBe(processors);
    });
  });
});

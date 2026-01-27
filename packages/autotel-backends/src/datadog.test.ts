import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatadogConfig } from './datadog';

describe('createDatadogConfig()', () => {
  describe('validation', () => {
    it('should throw if apiKey is missing for direct ingestion', () => {
      expect(() => {
        createDatadogConfig({
          service: 'test-service',
        });
      }).toThrow('Datadog API key is required for direct cloud ingestion');
    });

    it('should not throw if apiKey is missing when useAgent is true', () => {
      expect(() => {
        createDatadogConfig({
          service: 'test-service',
          useAgent: true,
        });
      }).not.toThrow();
    });
  });

  describe('direct cloud ingestion', () => {
    it('should return config with correct endpoint and headers', () => {
      const config = createDatadogConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
      });

      expect(config).toMatchObject({
        service: 'my-service',
        endpoint: 'https://otlp.datadoghq.com',
        headers: 'dd-api-key=test-api-key',
      });
    });

    it('should use correct endpoint for EU site', () => {
      const config = createDatadogConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
        site: 'datadoghq.eu',
      });

      expect(config.endpoint).toBe('https://otlp.datadoghq.eu');
    });

    it('should include environment and version when specified', () => {
      const config = createDatadogConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
        environment: 'production',
        version: '1.0.0',
      });

      expect(config.environment).toBe('production');
      expect(config.version).toBe('1.0.0');
    });
  });

  describe('agent mode', () => {
    it('should use agent endpoint when useAgent is true', () => {
      const config = createDatadogConfig({
        service: 'my-service',
        useAgent: true,
      });

      expect(config.endpoint).toBe('http://localhost:4318');
      expect(config.headers).toBeUndefined();
    });

    it('should use custom agent host and port', () => {
      const config = createDatadogConfig({
        service: 'my-service',
        useAgent: true,
        agentHost: 'dd-agent',
        agentPort: 4319,
      });

      expect(config.endpoint).toBe('http://dd-agent:4319');
    });
  });

  describe('enableLogs env var configuration', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear env vars before each test
      delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL;
      delete process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS;
      delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it('sets OTLP logs env vars for direct ingestion', () => {
      // Mock the peer dependencies to avoid the error
      vi.mock('@opentelemetry/sdk-logs', () => ({
        BatchLogRecordProcessor: vi.fn().mockImplementation(() => ({})),
      }));
      vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
        OTLPLogExporter: vi.fn().mockImplementation(() => ({})),
      }));

      try {
        createDatadogConfig({
          apiKey: 'test-key',
          site: 'datadoghq.eu',
          service: 'test-service',
          environment: 'production',
          version: '1.0.0',
          enableLogs: true,
        });
      } catch {
        // Ignore peer dependency error - we just want to test env var setting
      }

      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(
        'https://otlp.datadoghq.eu/v1/logs',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL).toBe(
        'http/protobuf',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBe(
        'dd-api-key=test-key',
      );
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
        'service.name=test-service',
      );
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
        'deployment.environment=production',
      );
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
        'service.version=1.0.0',
      );
    });

    it('sets OTLP logs env vars for agent mode (no api key header)', () => {
      try {
        createDatadogConfig({
          service: 'test-service',
          useAgent: true,
          agentHost: 'dd-agent',
          agentPort: 4318,
          enableLogs: true,
        });
      } catch {
        // Ignore peer dependency error
      }

      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(
        'http://dd-agent:4318/v1/logs',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL).toBe(
        'http/protobuf',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBeUndefined();
    });

    it('does not override existing env vars', () => {
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT =
        'http://custom:4318/v1/logs';
      process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'grpc';
      process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'custom-header=value';
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'custom.attr=value';

      try {
        createDatadogConfig({
          apiKey: 'test-key',
          service: 'test-service',
          enableLogs: true,
        });
      } catch {
        // Ignore peer dependency error
      }

      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(
        'http://custom:4318/v1/logs',
      );
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL).toBe('grpc');
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBe(
        'custom-header=value',
      );
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toBe('custom.attr=value');
    });

    it('sets resource attributes without optional fields when not provided', () => {
      try {
        createDatadogConfig({
          apiKey: 'test-key',
          service: 'test-service',
          enableLogs: true,
        });
      } catch {
        // Ignore peer dependency error
      }

      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toBe(
        'service.name=test-service',
      );
    });

    it('does not set env vars when enableLogs is false', () => {
      createDatadogConfig({
        apiKey: 'test-key',
        service: 'test-service',
        enableLogs: false,
      });

      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined();
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL).toBeUndefined();
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBeUndefined();
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toBeUndefined();
    });

    it('does not set env vars by default', () => {
      createDatadogConfig({
        apiKey: 'test-key',
        service: 'test-service',
      });

      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined();
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL).toBeUndefined();
      expect(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBeUndefined();
      expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toBeUndefined();
    });
  });
});

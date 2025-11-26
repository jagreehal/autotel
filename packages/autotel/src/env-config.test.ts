import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveOtelEnv,
  parseResourceAttributes,
  parseOtlpHeaders,
  envToConfig,
  resolveConfigFromEnv,
} from './env-config';

describe('env-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('resolveOtelEnv', () => {
    it('should resolve standard OTEL env vars', () => {
      process.env.OTEL_SERVICE_NAME = 'test-service';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http';

      const env = resolveOtelEnv();

      expect(env.OTEL_SERVICE_NAME).toBe('test-service');
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318');
      expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('http');
    });

    it('should return undefined for unset env vars', () => {
      const env = resolveOtelEnv();

      expect(env.OTEL_SERVICE_NAME).toBeUndefined();
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    });

    it('should validate protocol enum', () => {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
      const env = resolveOtelEnv();
      expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('grpc');
    });
  });

  describe('parseResourceAttributes', () => {
    it('should parse comma-separated key=value pairs', () => {
      const input = 'service.version=1.0.0,deployment.environment=production';
      const result = parseResourceAttributes(input);

      expect(result).toEqual({
        'service.version': '1.0.0',
        'deployment.environment': 'production',
      });
    });

    it('should handle single attribute', () => {
      const result = parseResourceAttributes('team=backend');
      expect(result).toEqual({ team: 'backend' });
    });

    it('should handle empty string', () => {
      expect(parseResourceAttributes('')).toEqual({});
      expect(parseResourceAttributes('   ')).toEqual({});
    });

    it('should handle undefined', () => {
      expect(parseResourceAttributes()).toEqual({});
    });

    it('should skip invalid pairs without =', () => {
      const result = parseResourceAttributes('valid=value,invalid,another=ok');
      expect(result).toEqual({
        valid: 'value',
        another: 'ok',
      });
    });

    it('should handle whitespace around keys and values', () => {
      const result = parseResourceAttributes(' key1 = value1 , key2 = value2 ');
      expect(result).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should skip empty pairs', () => {
      const result = parseResourceAttributes('key1=value1,,key2=value2');
      expect(result).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should handle values with = in them (takes first = as delimiter)', () => {
      const result = parseResourceAttributes('key=value=with=equals');
      expect(result).toEqual({
        key: 'value=with=equals',
      });
    });
  });

  describe('parseOtlpHeaders', () => {
    it('should parse comma-separated header pairs', () => {
      const input = 'api-key=secret123,x-custom-header=value';
      const result = parseOtlpHeaders(input);

      expect(result).toEqual({
        'api-key': 'secret123',
        'x-custom-header': 'value',
      });
    });

    it('should handle single header', () => {
      const result = parseOtlpHeaders('authorization=Bearer token');
      expect(result).toEqual({ authorization: 'Bearer token' });
    });

    it('should handle empty string', () => {
      expect(parseOtlpHeaders('')).toEqual({});
      expect(parseOtlpHeaders('   ')).toEqual({});
    });

    it('should handle undefined', () => {
      expect(parseOtlpHeaders()).toEqual({});
    });

    it('should skip invalid pairs', () => {
      const result = parseOtlpHeaders('valid=value,invalid,another=ok');
      expect(result).toEqual({
        valid: 'value',
        another: 'ok',
      });
    });

    it('should handle whitespace', () => {
      const result = parseOtlpHeaders(' key1 = value1 , key2 = value2 ');
      expect(result).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });
  });

  describe('envToConfig', () => {
    it('should map OTEL_SERVICE_NAME to service', () => {
      const config = envToConfig({
        OTEL_SERVICE_NAME: 'test-service',
      });

      expect(config.service).toBe('test-service');
    });

    it('should map OTEL_EXPORTER_OTLP_ENDPOINT to endpoint', () => {
      const config = envToConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      });

      expect(config.endpoint).toBe('http://localhost:4318');
    });

    it('should map OTEL_EXPORTER_OTLP_PROTOCOL to protocol', () => {
      const config = envToConfig({
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      });

      expect(config.protocol).toBe('grpc');
    });

    it('should parse OTEL_EXPORTER_OTLP_HEADERS', () => {
      const config = envToConfig({
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=secret,x-custom=value',
      });

      expect(config.otlpHeaders).toEqual({
        'api-key': 'secret',
        'x-custom': 'value',
      });
    });

    it('should parse OTEL_RESOURCE_ATTRIBUTES', () => {
      const config = envToConfig({
        OTEL_RESOURCE_ATTRIBUTES:
          'service.version=1.0.0,deployment.environment=prod',
      });

      expect(config.resourceAttributes).toEqual({
        'service.version': '1.0.0',
        'deployment.environment': 'prod',
      });
    });

    it('should return empty config for no env vars', () => {
      const config = envToConfig({});
      expect(config).toEqual({});
    });
  });

  describe('resolveConfigFromEnv', () => {
    it('should return config from env vars', () => {
      process.env.OTEL_SERVICE_NAME = 'test-service';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';

      const config = resolveConfigFromEnv();

      expect(config.service).toBe('test-service');
      expect(config.endpoint).toBe('http://localhost:4318');
    });

    it('should work with no env vars set', () => {
      const config = resolveConfigFromEnv();
      expect(config).toEqual({});
    });

    it('should parse complex real-world scenario', () => {
      process.env.OTEL_SERVICE_NAME = 'my-api';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://api.honeycomb.io';
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        'x-honeycomb-team=abc123,x-honeycomb-dataset=production';
      process.env.OTEL_RESOURCE_ATTRIBUTES =
        'service.version=1.2.3,deployment.environment=production,team=backend';
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http';

      const config = resolveConfigFromEnv();

      expect(config).toEqual({
        service: 'my-api',
        endpoint: 'https://api.honeycomb.io',
        protocol: 'http',
        otlpHeaders: {
          'x-honeycomb-team': 'abc123',
          'x-honeycomb-dataset': 'production',
        },
        resourceAttributes: {
          'service.version': '1.2.3',
          'deployment.environment': 'production',
          team: 'backend',
        },
      });
    });
  });
});

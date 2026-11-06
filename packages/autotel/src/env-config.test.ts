import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import {
  resolveOtelEnv,
  parseResourceAttributes,
  parseOtlpHeaders,
  createSamplerFromEnv,
  envToConfig,
  resolveConfigFromEnv,
  spanLimitsFromEnv,
  batchSpanOptionsFromEnv,
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

    it('should resolve trace sampler env vars', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.5';

      const env = resolveOtelEnv();

      expect(env.OTEL_TRACES_SAMPLER).toBe('traceidratio');
      expect(env.OTEL_TRACES_SAMPLER_ARG).toBe('0.5');
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
      expect(parseResourceAttributes(undefined)).toEqual({});
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
      expect(parseOtlpHeaders(undefined)).toEqual({});
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

      expect(config.headers).toEqual({
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

    it('should map OTEL_TRACES_SAMPLER to an SDK sampler', () => {
      const config = envToConfig({
        OTEL_TRACES_SAMPLER: 'always_on',
      });

      expect(config.otelSampler).toBeInstanceOf(AlwaysOnSampler);
    });
  });

  describe('createSamplerFromEnv', () => {
    it('supports always_on', () => {
      const sampler = createSamplerFromEnv({
        OTEL_TRACES_SAMPLER: 'always_on',
      });

      expect(sampler).toBeInstanceOf(AlwaysOnSampler);
    });

    it('supports always_off', () => {
      const sampler = createSamplerFromEnv({
        OTEL_TRACES_SAMPLER: 'always_off',
      });

      expect(sampler).toBeInstanceOf(AlwaysOffSampler);
    });

    it('supports traceidratio', () => {
      const sampler = createSamplerFromEnv({
        OTEL_TRACES_SAMPLER: 'traceidratio',
        OTEL_TRACES_SAMPLER_ARG: '0.25',
      });

      expect(sampler).toBeInstanceOf(TraceIdRatioBasedSampler);
    });

    it('supports parentbased_traceidratio', () => {
      const sampler = createSamplerFromEnv({
        OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
        OTEL_TRACES_SAMPLER_ARG: '0.25',
      });

      expect(sampler).toBeInstanceOf(ParentBasedSampler);
    });

    it('returns undefined for unsupported remote samplers', () => {
      const sampler = createSamplerFromEnv({
        OTEL_TRACES_SAMPLER: 'jaeger_remote',
      });

      expect(sampler).toBeUndefined();
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
        headers: {
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

    it('should include otelSampler when OTEL_TRACES_SAMPLER is set', () => {
      process.env.OTEL_TRACES_SAMPLER = 'parentbased_always_off';

      const config = resolveConfigFromEnv();

      expect(config.otelSampler).toBeInstanceOf(ParentBasedSampler);
    });
  });
});

describe('SDK settings the 3.x tracer no longer reads', () => {
  const names = [
    'OTEL_ATTRIBUTE_COUNT_LIMIT',
    'OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT',
    'OTEL_SPAN_LINK_COUNT_LIMIT',
    'OTEL_SPAN_EVENT_COUNT_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT',
    'OTEL_BSP_MAX_EXPORT_BATCH_SIZE',
    'OTEL_BSP_MAX_QUEUE_SIZE',
    'OTEL_BSP_SCHEDULE_DELAY',
    'OTEL_BSP_EXPORT_TIMEOUT',
  ];
  beforeEach(() => {
    for (const name of names) vi.stubEnv(name, '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets nothing when nothing is configured, so SDK defaults stay', () => {
    expect(spanLimitsFromEnv()).toEqual({});
    expect(batchSpanOptionsFromEnv()).toEqual({});
  });

  it('reads every span limit', () => {
    vi.stubEnv('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT', '1');
    vi.stubEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT', '2');
    vi.stubEnv('OTEL_SPAN_LINK_COUNT_LIMIT', '3');
    vi.stubEnv('OTEL_SPAN_EVENT_COUNT_LIMIT', '4');
    vi.stubEnv('OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT', '5');
    vi.stubEnv('OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT', '6');

    expect(spanLimitsFromEnv()).toEqual({
      attributeValueLengthLimit: 1,
      attributeCountLimit: 2,
      linkCountLimit: 3,
      eventCountLimit: 4,
      attributePerEventCountLimit: 5,
      attributePerLinkCountLimit: 6,
    });
  });

  it('falls back to the general limit, and prefers the span one', () => {
    vi.stubEnv('OTEL_ATTRIBUTE_COUNT_LIMIT', '7');
    vi.stubEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT', '8');
    vi.stubEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT', '9');

    expect(spanLimitsFromEnv()).toEqual({
      attributeCountLimit: 9,
      attributeValueLengthLimit: 8,
    });
  });

  it('reads every batch setting', () => {
    vi.stubEnv('OTEL_BSP_MAX_EXPORT_BATCH_SIZE', '1');
    vi.stubEnv('OTEL_BSP_MAX_QUEUE_SIZE', '2');
    vi.stubEnv('OTEL_BSP_SCHEDULE_DELAY', '3');
    vi.stubEnv('OTEL_BSP_EXPORT_TIMEOUT', '4');

    expect(batchSpanOptionsFromEnv()).toEqual({
      maxExportBatchSize: 1,
      maxQueueSize: 2,
      scheduledDelayMillis: 3,
      exportTimeoutMillis: 4,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createHoneycombConfig } from './honeycomb';

describe('createHoneycombConfig()', () => {
  describe('validation', () => {
    it('should throw if apiKey is missing', () => {
      expect(() => {
        createHoneycombConfig({
          // @ts-expect-error - testing missing apiKey
          service: 'test-service',
        });
      }).toThrow('Honeycomb API key is required');
    });

    it('should throw if apiKey is empty string', () => {
      expect(() => {
        createHoneycombConfig({
          apiKey: '',
          service: 'test-service',
        });
      }).toThrow('Honeycomb API key is required');
    });
  });

  describe('basic configuration', () => {
    it('should return minimal config with apiKey and service', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
      });

      expect(config).toMatchObject({
        service: 'my-service',
        protocol: 'grpc',
        endpoint: 'api.honeycomb.io:443',
        headers: {
          'x-honeycomb-team': 'test-api-key',
        },
      });
    });

    it('should use gRPC protocol by default', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
      });

      expect(config.protocol).toBe('grpc');
    });

    it('should use default Honeycomb endpoint', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-api-key',
        service: 'my-service',
      });

      expect(config.endpoint).toBe('api.honeycomb.io:443');
    });
  });

  describe('headers', () => {
    it('should set x-honeycomb-team header with API key', () => {
      const config = createHoneycombConfig({
        apiKey: 'my-secret-key',
        service: 'test-service',
      });

      expect(config.headers).toMatchObject({
        'x-honeycomb-team': 'my-secret-key',
      });
    });

    it('should add x-honeycomb-dataset header when dataset is specified', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        dataset: 'production',
      });

      expect(config.headers).toMatchObject({
        'x-honeycomb-team': 'test-key',
        'x-honeycomb-dataset': 'production',
      });
    });

    it('should add x-honeycomb-samplerate header when sampleRate is specified', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        sampleRate: 10,
      });

      expect(config.headers).toMatchObject({
        'x-honeycomb-team': 'test-key',
        'x-honeycomb-samplerate': '10',
      });
    });

    it('should include all headers when dataset and sampleRate are specified', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        dataset: 'my-dataset',
        sampleRate: 100,
      });

      expect(config.headers).toMatchObject({
        'x-honeycomb-team': 'test-key',
        'x-honeycomb-dataset': 'my-dataset',
        'x-honeycomb-samplerate': '100',
      });
    });

    it('should convert sampleRate to string', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        sampleRate: 50,
      });

      expect(typeof config.headers?.['x-honeycomb-samplerate']).toBe('string');
      expect(config.headers?.['x-honeycomb-samplerate']).toBe('50');
    });
  });

  describe('environment and version', () => {
    it('should include environment when specified', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        environment: 'production',
      });

      expect(config.environment).toBe('production');
    });

    it('should include version when specified', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        version: '2.1.0',
      });

      expect(config.version).toBe('2.1.0');
    });

    it('should include both environment and version', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        environment: 'staging',
        version: '1.5.3',
      });

      expect(config.environment).toBe('staging');
      expect(config.version).toBe('1.5.3');
    });
  });

  describe('custom endpoint', () => {
    it('should allow custom endpoint', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        endpoint: 'custom.honeycomb.io:8443',
      });

      expect(config.endpoint).toBe('custom.honeycomb.io:8443');
    });

    it('should allow EU endpoint', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'test-service',
        endpoint: 'api.eu1.honeycomb.io:443',
      });

      expect(config.endpoint).toBe('api.eu1.honeycomb.io:443');
    });
  });

  describe('complete configuration', () => {
    it('should handle all options together', () => {
      const config = createHoneycombConfig({
        apiKey: 'complete-test-key',
        service: 'complete-service',
        dataset: 'complete-dataset',
        environment: 'production',
        version: '3.2.1',
        endpoint: 'custom.endpoint.io:9000',
        sampleRate: 25,
      });

      expect(config).toEqual({
        service: 'complete-service',
        environment: 'production',
        version: '3.2.1',
        protocol: 'grpc',
        endpoint: 'custom.endpoint.io:9000',
        headers: {
          'x-honeycomb-team': 'complete-test-key',
          'x-honeycomb-dataset': 'complete-dataset',
          'x-honeycomb-samplerate': '25',
        },
      });
    });
  });

  describe('real-world scenarios', () => {
    it('should configure for classic Honeycomb account with dataset', () => {
      const config = createHoneycombConfig({
        apiKey: process.env.HONEYCOMB_API_KEY || 'test-key',
        service: 'my-app',
        dataset: 'production',
        environment: 'production',
      });

      expect(config.headers).toHaveProperty('x-honeycomb-dataset');
      expect(config.protocol).toBe('grpc');
    });

    it('should configure for modern Honeycomb account without dataset', () => {
      const config = createHoneycombConfig({
        apiKey: process.env.HONEYCOMB_API_KEY || 'test-key',
        service: 'my-app',
        environment: 'production',
      });

      expect(config.headers).not.toHaveProperty('x-honeycomb-dataset');
      expect(config.protocol).toBe('grpc');
    });

    it('should configure with head-based sampling', () => {
      const config = createHoneycombConfig({
        apiKey: 'test-key',
        service: 'high-volume-app',
        sampleRate: 100, // Sample 1% of traces
      });

      expect(config.headers).toHaveProperty('x-honeycomb-samplerate', '100');
    });
  });
});

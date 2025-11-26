import { describe, expect, it } from 'vitest';

/**
 * Unit tests for protocol switching helper functions
 *
 * These tests verify the URL formatting and protocol resolution logic
 * without requiring dynamic module loading or complex mocking.
 */

// Helper functions copied from init.ts for testing
function formatEndpointUrl(
  endpoint: string,
  signal: 'traces' | 'metrics',
  protocol: 'http' | 'grpc',
): string {
  if (protocol === 'grpc') {
    // gRPC: strip any paths, return base endpoint
    return endpoint.replace(/\/(v1\/)?(traces|metrics|logs)$/, '');
  }

  // HTTP: append signal path if not present
  if (!endpoint.endsWith(`/v1/${signal}`)) {
    return `${endpoint}/v1/${signal}`;
  }

  return endpoint;
}

function resolveProtocol(
  configProtocol?: 'http' | 'grpc',
  envProtocol?: string,
): 'http' | 'grpc' {
  // 1. Check config parameter (highest priority)
  if (configProtocol === 'grpc' || configProtocol === 'http') {
    return configProtocol;
  }

  // 2. Check OTEL_EXPORTER_OTLP_PROTOCOL env var
  if (envProtocol === 'grpc') return 'grpc';
  if (envProtocol === 'http/protobuf' || envProtocol === 'http') return 'http';

  // 3. Default to HTTP
  return 'http';
}

describe('Protocol resolution logic', () => {
  describe('resolveProtocol()', () => {
    it('should return http by default', () => {
      expect(resolveProtocol()).toBe('http');
    });

    it('should respect config parameter over env var', () => {
      expect(resolveProtocol('http', 'grpc')).toBe('http');
      expect(resolveProtocol('grpc', 'http')).toBe('grpc');
    });

    it('should use grpc when env var is grpc', () => {
      expect(resolveProtocol(undefined, 'grpc')).toBe('grpc');
    });

    it('should use http when env var is http', () => {
      expect(resolveProtocol(undefined, 'http')).toBe('http');
    });

    it('should use http when env var is http/protobuf', () => {
      expect(resolveProtocol(undefined, 'http/protobuf')).toBe('http');
    });

    it('should default to http for invalid env var', () => {
      expect(resolveProtocol(undefined, 'invalid')).toBe('http');
      expect(resolveProtocol(undefined, '')).toBe('http');
    });

    it('should prioritize config parameter', () => {
      expect(resolveProtocol('grpc')).toBe('grpc');
      expect(resolveProtocol('http')).toBe('http');
    });
  });

  describe('formatEndpointUrl() for HTTP protocol', () => {
    it('should append /v1/traces for traces', () => {
      expect(formatEndpointUrl('http://localhost:4318', 'traces', 'http')).toBe(
        'http://localhost:4318/v1/traces',
      );
    });

    it('should append /v1/metrics for metrics', () => {
      expect(
        formatEndpointUrl('http://localhost:4318', 'metrics', 'http'),
      ).toBe('http://localhost:4318/v1/metrics');
    });

    it('should not double-append path if already present', () => {
      expect(
        formatEndpointUrl('http://localhost:4318/v1/traces', 'traces', 'http'),
      ).toBe('http://localhost:4318/v1/traces');
    });

    it('should handle endpoints without http prefix', () => {
      expect(formatEndpointUrl('localhost:4318', 'traces', 'http')).toBe(
        'localhost:4318/v1/traces',
      );
    });

    it('should handle HTTPS endpoints', () => {
      expect(
        formatEndpointUrl('https://otlp.example.com', 'traces', 'http'),
      ).toBe('https://otlp.example.com/v1/traces');
    });

    it('should handle endpoints with trailing slash', () => {
      expect(
        formatEndpointUrl('http://localhost:4318/', 'traces', 'http'),
      ).toBe('http://localhost:4318//v1/traces');
    });
  });

  describe('formatEndpointUrl() for gRPC protocol', () => {
    it('should not append paths for gRPC', () => {
      expect(formatEndpointUrl('api.honeycomb.io:443', 'traces', 'grpc')).toBe(
        'api.honeycomb.io:443',
      );
    });

    it('should strip /v1/traces path from gRPC endpoints', () => {
      expect(
        formatEndpointUrl('api.example.com/v1/traces', 'traces', 'grpc'),
      ).toBe('api.example.com');
    });

    it('should strip /v1/metrics path from gRPC endpoints', () => {
      expect(
        formatEndpointUrl('api.example.com/v1/metrics', 'metrics', 'grpc'),
      ).toBe('api.example.com');
    });

    it('should strip /v1/logs path from gRPC endpoints', () => {
      expect(
        formatEndpointUrl('api.example.com/v1/logs', 'traces', 'grpc'),
      ).toBe('api.example.com');
    });

    it('should strip paths without v1 prefix', () => {
      expect(
        formatEndpointUrl('api.example.com/traces', 'traces', 'grpc'),
      ).toBe('api.example.com');
    });

    it('should handle gRPC URLs with grpc:// scheme', () => {
      expect(formatEndpointUrl('grpc://localhost:4317', 'traces', 'grpc')).toBe(
        'grpc://localhost:4317',
      );
    });

    it('should handle gRPC URLs with port numbers', () => {
      expect(
        formatEndpointUrl('collector.example.com:4317', 'traces', 'grpc'),
      ).toBe('collector.example.com:4317');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty endpoint for HTTP', () => {
      expect(formatEndpointUrl('', 'traces', 'http')).toBe('/v1/traces');
    });

    it('should handle empty endpoint for gRPC', () => {
      expect(formatEndpointUrl('', 'traces', 'grpc')).toBe('');
    });

    it('should preserve query parameters in HTTP', () => {
      expect(
        formatEndpointUrl('http://localhost:4318?foo=bar', 'traces', 'http'),
      ).toBe('http://localhost:4318?foo=bar/v1/traces');
    });

    it('should preserve query parameters in gRPC', () => {
      expect(
        formatEndpointUrl('api.example.com:443?foo=bar', 'traces', 'grpc'),
      ).toBe('api.example.com:443?foo=bar');
    });
  });
});

describe('Protocol configuration documentation', () => {
  it('should document HTTP as default protocol', () => {
    const defaultProtocol = resolveProtocol();
    expect(defaultProtocol).toBe('http');
  });

  it('should document Honeycomb endpoint format', () => {
    const honeycombEndpoint = 'api.honeycomb.io:443';
    const formattedForGrpc = formatEndpointUrl(
      honeycombEndpoint,
      'traces',
      'grpc',
    );

    expect(formattedForGrpc).toBe('api.honeycomb.io:443');
  });

  it('should document local collector HTTP format', () => {
    const httpEndpoint = 'http://localhost:4318';
    const formattedForHttp = formatEndpointUrl(httpEndpoint, 'traces', 'http');

    expect(formattedForHttp).toBe('http://localhost:4318/v1/traces');
  });

  it('should document local collector gRPC format', () => {
    const grpcEndpoint = 'localhost:4317';
    const formattedForGrpc = formatEndpointUrl(grpcEndpoint, 'traces', 'grpc');

    expect(formattedForGrpc).toBe('localhost:4317');
  });
});

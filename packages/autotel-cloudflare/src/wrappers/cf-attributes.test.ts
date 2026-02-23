import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrument } from './instrument';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('CF Attributes extraction via instrument()', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let capturedSpanOptions: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    capturedSpanOptions = null;

    mockTracer = {
      startActiveSpan: vi.fn((...args: any[]) => {
        // startActiveSpan can be called with (name, options, context, fn) or (name, options, fn)
        // The fetch instrumentation calls it with 4 args: (name, options, parentContext, fn)
        const fn = args.at(-1);
        if (args.length >= 2) {
          capturedSpanOptions = args[1];
        }
        return fn(mockSpan);
      }),
      setHeadSampler: vi.fn(),
      forceFlush: vi.fn(async () => {}),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  function createMockCtx() {
    return {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;
  }

  it('should extract CF attributes when request has .cf object', async () => {
    const handler = {
      async fetch(request: Request) {
        return new Response('OK', { status: 200 });
      },
    };

    const instrumented = instrument(handler, {
      service: { name: 'test-worker' },
    });

    const request = new Request('http://example.com/test');
    // Attach .cf properties to the request (Cloudflare Workers runtime does this)
    Object.defineProperty(request, 'cf', {
      value: {
        colo: 'SJC',
        country: 'US',
        city: 'San Jose',
        region: 'California',
        continent: 'NA',
        timezone: 'America/Los_Angeles',
        latitude: '37.3382',
        longitude: '-121.8863',
        asn: 13_335,
        asOrganization: 'Cloudflare Inc',
        httpProtocol: 'HTTP/2',
        tlsVersion: 'TLSv1.3',
        clientTcpRtt: 5,
      },
      writable: false,
      enumerable: true,
    });

    const env = {} as any;
    const ctx = createMockCtx();

    await instrumented.fetch!(request, env, ctx);

    expect(capturedSpanOptions).toBeDefined();
    const attrs = capturedSpanOptions.attributes;

    expect(attrs['cloudflare.colo']).toBe('SJC');
    expect(attrs['cloudflare.country']).toBe('US');
    expect(attrs['cloudflare.city']).toBe('San Jose');
    expect(attrs['cloudflare.region']).toBe('California');
    expect(attrs['cloudflare.continent']).toBe('NA');
    expect(attrs['cloudflare.timezone']).toBe('America/Los_Angeles');
    expect(attrs['cloudflare.latitude']).toBe('37.3382');
    expect(attrs['cloudflare.longitude']).toBe('-121.8863');
    expect(attrs['cloudflare.asn']).toBe(13_335);
    expect(attrs['cloudflare.as_organization']).toBe('Cloudflare Inc');
    expect(attrs['cloudflare.http_protocol']).toBe('HTTP/2');
    expect(attrs['cloudflare.tls_version']).toBe('TLSv1.3');
    expect(attrs['cloudflare.client_tcp_rtt']).toBe(5);
  });

  it('should extract CF ray_id from cf-ray header', async () => {
    const handler = {
      async fetch(request: Request) {
        return new Response('OK', { status: 200 });
      },
    };

    const instrumented = instrument(handler, {
      service: { name: 'test-worker' },
    });

    const request = new Request('http://example.com/test', {
      headers: {
        'cf-ray': '8a1b2c3d4e5f6-SJC',
      },
    });
    Object.defineProperty(request, 'cf', {
      value: { colo: 'SJC' },
      writable: false,
      enumerable: true,
    });

    const env = {} as any;
    const ctx = createMockCtx();

    await instrumented.fetch!(request, env, ctx);

    expect(capturedSpanOptions).toBeDefined();
    const attrs = capturedSpanOptions.attributes;
    expect(attrs['cloudflare.ray_id']).toBe('8a1b2c3d4e5f6-SJC');
    expect(attrs['cloudflare.colo']).toBe('SJC');
  });

  it('should not include CF attributes when request.cf is undefined', async () => {
    const handler = {
      async fetch(request: Request) {
        return new Response('OK', { status: 200 });
      },
    };

    const instrumented = instrument(handler, {
      service: { name: 'test-worker' },
    });

    // Standard request without .cf (local dev / Miniflare scenario)
    const request = new Request('http://example.com/test');
    const env = {} as any;
    const ctx = createMockCtx();

    await instrumented.fetch!(request, env, ctx);

    expect(capturedSpanOptions).toBeDefined();
    const attrs = capturedSpanOptions.attributes;

    // Standard HTTP attributes should still be present
    expect(attrs['http.request.method']).toBe('GET');
    expect(attrs['url.full']).toBe('http://example.com/test');

    // No cloudflare.* attributes should be present
    const cfKeys = Object.keys(attrs).filter(k => k.startsWith('cloudflare.'));
    expect(cfKeys).toHaveLength(0);
  });

  it('should correctly map all CF fields to cloudflare.* attribute names', async () => {
    const handler = {
      async fetch(request: Request) {
        return new Response('OK', { status: 200 });
      },
    };

    const instrumented = instrument(handler, {
      service: { name: 'test-worker' },
    });

    const request = new Request('http://example.com/test', {
      headers: { 'cf-ray': 'abc123-LAX' },
    });
    Object.defineProperty(request, 'cf', {
      value: {
        colo: 'LAX',
        country: 'US',
        city: 'Los Angeles',
        region: 'California',
        continent: 'NA',
        timezone: 'America/Los_Angeles',
        latitude: '34.0522',
        longitude: '-118.2437',
        asn: 13_335,
        asOrganization: 'Cloudflare Inc',
        httpProtocol: 'HTTP/3',
        tlsVersion: 'TLSv1.3',
        clientTcpRtt: 10,
      },
      writable: false,
      enumerable: true,
    });

    const env = {} as any;
    const ctx = createMockCtx();

    await instrumented.fetch!(request, env, ctx);

    const attrs = capturedSpanOptions.attributes;

    // Verify the exact mapping from CF property names to attribute names
    const expectedMappings: Record<string, [string, any]> = {
      'cloudflare.colo': ['colo', 'LAX'],
      'cloudflare.ray_id': ['cf-ray header', 'abc123-LAX'],
      'cloudflare.country': ['country', 'US'],
      'cloudflare.city': ['city', 'Los Angeles'],
      'cloudflare.region': ['region', 'California'],
      'cloudflare.continent': ['continent', 'NA'],
      'cloudflare.timezone': ['timezone', 'America/Los_Angeles'],
      'cloudflare.latitude': ['latitude', '34.0522'],
      'cloudflare.longitude': ['longitude', '-118.2437'],
      'cloudflare.asn': ['asn', 13_335],
      'cloudflare.as_organization': ['asOrganization', 'Cloudflare Inc'],
      'cloudflare.http_protocol': ['httpProtocol', 'HTTP/3'],
      'cloudflare.tls_version': ['tlsVersion', 'TLSv1.3'],
      'cloudflare.client_tcp_rtt': ['clientTcpRtt', 10],
    };

    for (const [attrKey, [, expectedValue]] of Object.entries(expectedMappings)) {
      expect(attrs[attrKey]).toBe(expectedValue);
    }
  });

  it('preserves valid falsy numeric CF attributes (0 values)', async () => {
    const handler = {
      async fetch(_request: Request) {
        return new Response('OK', { status: 200 });
      },
    };

    const instrumented = instrument(handler, {
      service: { name: 'test-worker' },
    });

    const request = new Request('http://example.com/test');
    Object.defineProperty(request, 'cf', {
      value: {
        latitude: 0,
        longitude: 0,
        asn: 0,
        clientTcpRtt: 0,
      },
      writable: false,
      enumerable: true,
    });

    const env = {} as any;
    const ctx = createMockCtx();

    await instrumented.fetch!(request, env, ctx);

    const attrs = capturedSpanOptions.attributes;
    expect(attrs['cloudflare.latitude']).toBe(0);
    expect(attrs['cloudflare.longitude']).toBe(0);
    expect(attrs['cloudflare.asn']).toBe(0);
    expect(attrs['cloudflare.client_tcp_rtt']).toBe(0);
  });
});

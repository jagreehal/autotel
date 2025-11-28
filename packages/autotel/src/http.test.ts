import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HttpInstrumented,
  traceHttpRequest,
  injectTraceContext,
  extractTraceContext,
} from './http';
import { configure, resetConfig } from './config';

describe('HttpInstrumented', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('should instrument HTTP methods', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented({ serviceName: 'api-client' })
    class ApiClient {
      async getUser(userId: string) {
        return { status: 200, data: { id: userId, name: 'Test' } };
      }
    }

    const client = new ApiClient();
    const result = await client.getUser('123');

    expect(result.data).toEqual({ id: '123', name: 'Test' });
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP GET 123',
      expect.any(Function),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'http.method': 'GET',
        'service.name': 'api-client',
        'operation.name': 'api-client.getUser',
      }),
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should infer HTTP methods from method names', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented()
    class ApiClient {
      async fetchData() {
        return { status: 200 };
      }
      async createUser() {
        return { status: 201 };
      }
      async updateProfile() {
        return { status: 200 };
      }
      async deleteAccount() {
        return { status: 204 };
      }
    }

    const client = new ApiClient();

    await client.fetchData();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP GET',
      expect.any(Function),
    );

    await client.createUser();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP POST',
      expect.any(Function),
    );

    await client.updateProfile();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP PUT',
      expect.any(Function),
    );

    await client.deleteAccount();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP DELETE',
      expect.any(Function),
    );
  });

  it('should extract URL and parse it', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented()
    class ApiClient {
      async getUser(url: string) {
        return { status: 200, url };
      }
    }

    const client = new ApiClient();
    await client.getUser('https://api.example.com/users/123?include=profile');

    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'HTTP GET /users/123',
      expect.any(Function),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'http.scheme': 'https',
        'http.host': 'api.example.com',
        'http.target': '/users/123?include=profile',
      }),
    );
  });

  it('should mark slow requests', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented({ slowRequestThresholdMs: 10 })
    class ApiClient {
      async slowRequest() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { status: 200 };
      }
    }

    const client = new ApiClient();
    await client.slowRequest();

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'http.slow_request',
      true,
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'http.slow_request_threshold_ms',
      10,
    );
  });

  it('should mark 4xx/5xx as errors', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented()
    class ApiClient {
      async notFound() {
        return { status: 404 };
      }
    }

    const client = new ApiClient();
    await client.notFound();

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2, // SpanStatusCode.ERROR
      message: 'HTTP 404',
    });
  });

  it('should handle errors correctly', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    @HttpInstrumented()
    class ApiClient {
      async failingRequest() {
        throw new Error('Network timeout');
      }
    }

    const client = new ApiClient();

    await expect(client.failingRequest()).rejects.toThrow('Network timeout');

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2, // SpanStatusCode.ERROR
      message: 'Network timeout',
    });
    expect(mockSpan.end).toHaveBeenCalled();
  });
});

describe('traceHttpRequest', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('should trace HTTP requests', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, optionsOrFn, maybeFn) => {
        const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
        return fn(mockSpan);
      }),
    };

    configure({
      tracer: mockTracer as any,
    });

    const result = await traceHttpRequest(
      'GET /api/users',
      async () => ({ data: [1, 2, 3] }),
      {
        'http.method': 'GET',
        'http.target': '/api/users',
      },
    );

    expect(result).toEqual({ data: [1, 2, 3] });
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'GET /api/users',
      expect.any(Function),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith({
      'http.method': 'GET',
      'http.target': '/api/users',
    });
    expect(mockSpan.end).toHaveBeenCalled();
  });
});

describe('injectTraceContext', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(async () => {
    // Clean up any SDK that might have been initialized
    const { shutdown } = await import('./shutdown');
    await shutdown().catch(() => {
      // Ignore errors if SDK wasn't initialized
    });
    resetConfig();
  });

  it('should inject trace headers using propagation.inject', async () => {
    const { propagation } = await import('@opentelemetry/api');

    // Mock propagation.inject to simulate W3C trace context injection
    const injectSpy = vi
      .spyOn(propagation, 'inject')
      .mockImplementation((ctx, carrier) => {
        // Simulate W3C trace context propagation
        (carrier as Record<string, string>)['traceparent'] =
          '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
      });

    const headers = injectTraceContext({
      'Content-Type': 'application/json',
    });

    expect(injectSpy).toHaveBeenCalled();
    expect(headers['traceparent']).toBe(
      '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    );
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should work with empty headers', async () => {
    const { propagation } = await import('@opentelemetry/api');
    const injectSpy = vi.spyOn(propagation, 'inject');

    const headers = injectTraceContext();

    expect(injectSpy).toHaveBeenCalled();
    expect(headers).toBeDefined();
  });

  it('should inject baggage header when baggage is present', async () => {
    const { propagation } = await import('@opentelemetry/api');

    // Mock propagation.inject to simulate baggage propagation
    const injectSpy = vi
      .spyOn(propagation, 'inject')
      .mockImplementation((ctx, carrier) => {
        (carrier as Record<string, string>)['traceparent'] =
          '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
        (carrier as Record<string, string>)['baggage'] = 'tenant.id=tenant-123';
      });

    const headers = injectTraceContext({ 'Content-Type': 'application/json' });

    expect(injectSpy).toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['baggage']).toBe('tenant.id=tenant-123');
  });

  it('should inject baggage set via ctx.setBaggage()', async () => {
    const { trace } = await import('./functional');
    const { propagation, context: otelContext } =
      await import('@opentelemetry/api');
    const { init } = await import('./init');
    const { shutdown } = await import('./shutdown');
    const { InMemorySpanExporter } = await import('./exporters');
    const { SimpleSpanProcessor } = await import('./processors');
    const { AsyncLocalStorageContextManager } =
      await import('@opentelemetry/context-async-hooks');

    // Clean up any existing SDK first
    await shutdown().catch(() => {
      // Ignore errors if SDK wasn't initialized
    });

    // Set up proper OpenTelemetry SDK for this test
    const exporter = new InMemorySpanExporter();
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    otelContext.setGlobalContextManager(contextManager);

    init({
      service: 'test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
      metrics: false,
    });

    try {
      // Track what context was passed to propagation.inject
      let injectedContext: unknown = null;
      const injectSpy = vi
        .spyOn(propagation, 'inject')
        .mockImplementation((ctx, carrier) => {
          injectedContext = ctx;
          // Extract baggage from context to verify it's included
          const baggage = propagation.getBaggage(ctx as any);
          if (baggage) {
            const baggageEntries: string[] = [];
            for (const [key, entry] of baggage.getAllEntries()) {
              baggageEntries.push(`${key}=${entry.value}`);
            }
            if (baggageEntries.length > 0) {
              (carrier as Record<string, string>)['baggage'] =
                baggageEntries.join(',');
            }
          }
        });

      const testFn = trace((ctx) => async () => {
        // Set baggage via ctx.setBaggage()
        ctx.setBaggage('tenant.id', 't1');
        ctx.setBaggage('user.id', 'u1');

        // Inject trace context - should include the baggage we just set
        const headers = injectTraceContext();
        return headers;
      });

      const headers = await testFn();

      expect(injectSpy).toHaveBeenCalled();
      expect(injectedContext).toBeTruthy();
      // Verify baggage was included in the injected context
      const baggage = propagation.getBaggage(injectedContext as any);
      expect(baggage).toBeTruthy();
      expect(baggage?.getEntry('tenant.id')?.value).toBe('t1');
      expect(baggage?.getEntry('user.id')?.value).toBe('u1');
      expect(headers['baggage']).toContain('tenant.id=t1');
      expect(headers['baggage']).toContain('user.id=u1');

      injectSpy.mockRestore();
    } finally {
      // Clean up
      await shutdown().catch(() => {
        // Ignore errors
      });
      // Reset config for other tests
      resetConfig();
    }
  });
});

describe('extractTraceContext', () => {
  it('should extract trace context from headers', () => {
    const headers = {
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      baggage: 'tenant.id=tenant-123',
    };

    const extractedContext = extractTraceContext(headers);

    // Context should be extracted (actual validation depends on propagator)
    expect(extractedContext).toBeDefined();
  });

  it('should handle array headers', () => {
    const headers = {
      traceparent: ['00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'],
      baggage: ['tenant.id=tenant-123'],
    };

    const extractedContext = extractTraceContext(headers);

    expect(extractedContext).toBeDefined();
  });

  it('should handle missing headers gracefully', () => {
    const headers = {};

    const extractedContext = extractTraceContext(headers);

    // Should return a context even if no trace headers are present
    expect(extractedContext).toBeDefined();
  });
});

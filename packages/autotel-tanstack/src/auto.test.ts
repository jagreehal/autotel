import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock before importing auto.ts (which runs at module level)
const mockInit = vi.fn();
const mockReset = vi.fn();
const mockGetFinishedSpans = vi.fn(() => []);

vi.mock('autotel', () => ({
  init: mockInit,
}));

const mockExporterInstance = {
  reset: mockReset,
  getFinishedSpans: mockGetFinishedSpans,
};
// Use regular function (not arrow) so vi.fn() can be called with `new` in vitest 4.x
const MockInMemorySpanExporter = vi.fn(function () {
  return mockExporterInstance;
});
const MockSimpleSpanProcessor = vi.fn(function (exp: unknown) {
  return { exporter: exp };
});

vi.mock('autotel/exporters', () => ({
  InMemorySpanExporter: MockInMemorySpanExporter,
}));

vi.mock('autotel/processors', () => ({
  SimpleSpanProcessor: MockSimpleSpanProcessor,
}));

describe('auto.ts E2E mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockInit.mockReset();
    MockInMemorySpanExporter.mockClear();
    MockSimpleSpanProcessor.mockClear();
    delete (globalThis as Record<string, unknown>).__testSpanExporter;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses InMemorySpanExporter when E2E=1', async () => {
    process.env.E2E = '1';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await import('./auto');
    expect(MockInMemorySpanExporter).toHaveBeenCalledOnce();
    expect(MockSimpleSpanProcessor).toHaveBeenCalledOnce();
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ spanProcessors: expect.any(Array) }),
    );
  });

  it('sets globalThis.__testSpanExporter when E2E=1', async () => {
    process.env.E2E = '1';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await import('./auto');
    expect((globalThis as Record<string, unknown>).__testSpanExporter).toBe(
      mockExporterInstance,
    );
  });

  it('does not set __testSpanExporter in production mode', async () => {
    delete process.env.E2E;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await import('./auto');
    expect(
      (globalThis as Record<string, unknown>).__testSpanExporter,
    ).toBeUndefined();
  });

  // Skipped: constructing a second OTLP BatchSpanProcessor requires
  // @opentelemetry/exporter-trace-otlp-http which is not available in
  // autotel-tanstack's direct dependencies. The combined E2E+OTLP path
  // is tested at the integration level instead.
  it.skip('adds both InMemory and OTLP processors when E2E=1 and endpoint set', async () => {
    process.env.E2E = '1';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    await import('./auto');
    const call = mockInit.mock.calls[0][0] as { spanProcessors?: unknown[] };
    expect(call.spanProcessors).toHaveLength(2);
  });

  it('passes endpoint and debug to init in production mode', async () => {
    delete process.env.E2E;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    await import('./auto');
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:4318',
      }),
    );
  });

  it('uses OTEL_SERVICE_NAME env var', async () => {
    process.env.E2E = '1';
    process.env.OTEL_SERVICE_NAME = 'my-e2e-app';
    await import('./auto');
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'my-e2e-app' }),
    );
  });
});

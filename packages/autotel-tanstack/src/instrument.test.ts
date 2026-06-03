import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the values exist when the (also-hoisted) vi.mock factories run,
// since instrument is imported statically below.
const {
  mockInit,
  mockIsInitialized,
  mockExporter,
  MockInMemorySpanExporter,
  MockSimpleSpanProcessor,
} = vi.hoisted(() => {
  const exporter = { reset: vi.fn(), getFinishedSpans: vi.fn(() => []) };
  return {
    mockInit: vi.fn(),
    mockIsInitialized: vi.fn(() => false),
    mockExporter: exporter,
    MockInMemorySpanExporter: vi.fn(function () {
      return exporter;
    }),
    MockSimpleSpanProcessor: vi.fn(function (exp: unknown) {
      return { exporter: exp };
    }),
  };
});

vi.mock('autotel', () => ({
  init: mockInit,
  isInitialized: mockIsInitialized,
}));
vi.mock('autotel/exporters', () => ({
  InMemorySpanExporter: MockInMemorySpanExporter,
}));
vi.mock('autotel/processors', () => ({
  SimpleSpanProcessor: MockSimpleSpanProcessor,
}));

import { instrument } from './instrument';

type InitCall = {
  service?: string;
  endpoint?: string;
  debug?: boolean | 'pretty';
  logs?: unknown;
  subscribers?: unknown;
  spanProcessors?: unknown[];
};
const lastInit = () => mockInit.mock.calls[0][0] as InitCall;

describe('instrument()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockInit.mockReset();
    mockIsInitialized.mockReturnValue(false);
    MockInMemorySpanExporter.mockClear();
    MockSimpleSpanProcessor.mockClear();
    delete (globalThis as Record<string, unknown>).__testSpanExporter;
    delete process.env.E2E;
    delete process.env.AUTOTEL_DEBUG;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is idempotent — does nothing when already initialized', () => {
    mockIsInitialized.mockReturnValue(true);
    instrument({ service: 'x' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('defaults the service name to tanstack-start', () => {
    instrument();
    expect(lastInit().service).toBe('tanstack-start');
  });

  it('prefers an explicit service over OTEL_SERVICE_NAME', () => {
    process.env.OTEL_SERVICE_NAME = 'from-env';
    instrument({ service: 'explicit' });
    expect(lastInit().service).toBe('explicit');
  });

  it('falls back to OTEL_SERVICE_NAME', () => {
    process.env.OTEL_SERVICE_NAME = 'from-env';
    instrument();
    expect(lastInit().service).toBe('from-env');
  });

  it('passes options straight through to init in normal mode', () => {
    const subscribers = [{ name: 'sub' } as never];
    instrument({
      endpoint: 'http://collector:4318',
      subscribers,
      logs: true,
    });
    const call = lastInit();
    expect(call.endpoint).toBe('http://collector:4318');
    expect(call.subscribers).toBe(subscribers);
    expect(call.logs).toBe(true);
    expect(call.spanProcessors).toBeUndefined();
  });

  it('resolves debug from AUTOTEL_DEBUG', () => {
    process.env.AUTOTEL_DEBUG = 'pretty';
    instrument({ endpoint: 'http://c:4318' });
    expect(lastInit().debug).toBe('pretty');
  });

  it('pretty-prints in dev when no endpoint is set', () => {
    process.env.NODE_ENV = 'development';
    instrument();
    expect(lastInit().debug).toBe('pretty');
  });

  it('captures spans in memory under E2E=1 and skips OTLP + logs', () => {
    process.env.E2E = '1';
    const subscribers = [{ name: 'sub' } as never];
    instrument({ endpoint: 'http://c:4318', subscribers, logs: true });

    expect(MockInMemorySpanExporter).toHaveBeenCalledOnce();
    const call = lastInit();
    expect(call.spanProcessors).toHaveLength(1);
    expect(call.endpoint).toBeUndefined(); // no OTLP shipping in tests
    expect(call.logs).toBeUndefined(); // logs off in E2E
    expect(call.subscribers).toBe(subscribers); // subscribers still flow
    expect((globalThis as Record<string, unknown>).__testSpanExporter).toBe(
      mockExporter,
    );
  });
});

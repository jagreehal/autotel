import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockBatchLogRecordProcessor = vi.fn();
const mockOTLPLogExporter = vi.fn();

vi.mock('./node-require', () => ({
  safeRequire: vi.fn((id: string) => {
    if (id === '@opentelemetry/sdk-logs') {
      return { BatchLogRecordProcessor: mockBatchLogRecordProcessor };
    }
    if (id === '@opentelemetry/exporter-logs-otlp-http') {
      return { OTLPLogExporter: mockOTLPLogExporter };
    }
    return undefined;
  }),
}));

import { buildPostHogLogProcessors } from './posthog-logs';

describe('buildPostHogLogProcessors', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns processor when posthog.url is configured', () => {
    const result = buildPostHogLogProcessors({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(mockBatchLogRecordProcessor).toHaveBeenCalled();
  });

  it('returns processor from POSTHOG_LOGS_URL env var', () => {
    process.env.POSTHOG_LOGS_URL =
      'https://eu.i.posthog.com/i/v1/logs?token=phc_eu';
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://eu.i.posthog.com/i/v1/logs?token=phc_eu',
    });
  });

  it('config.url takes precedence over env var', () => {
    process.env.POSTHOG_LOGS_URL = 'https://env-url.com';
    const result = buildPostHogLogProcessors({ url: 'https://config-url.com' });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://config-url.com',
    });
  });

  it('returns empty array when no url configured', () => {
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(0);
    expect(mockOTLPLogExporter).not.toHaveBeenCalled();
  });

  it('accepts a second stringRedactor parameter without error', () => {
    const redactor = (s: string) => s.replace(/secret/g, '***');
    const result = buildPostHogLogProcessors(
      { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test' },
      redactor,
    );
    expect(result).toHaveLength(1);
  });

  it('returns empty array when called with undefined, undefined', () => {
    const result = buildPostHogLogProcessors(undefined, undefined);
    expect(result).toHaveLength(0);
  });

  it('redacts string values inside attribute arrays before emitting', () => {
    const wrappedOnEmit = vi.fn();
    mockBatchLogRecordProcessor.mockImplementation(function () {
      return {
        onEmit: wrappedOnEmit,
        shutdown: vi.fn().mockResolvedValue(undefined),
        forceFlush: vi.fn().mockResolvedValue(undefined),
      };
    });

    const [processor] = buildPostHogLogProcessors(
      { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test' },
      (value: string) => value.replace(/secret/g, '***'),
    );

    const record = {
      body: 'ok',
      attributes: {
        tags: ['public', 'secret'],
      },
    };

    processor.onEmit(record as any);

    expect(wrappedOnEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          tags: ['public', '***'],
        },
      }),
      undefined,
    );
  });
});

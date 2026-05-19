import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExportResultCode } from '@opentelemetry/core';
import { AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { CloudWatchTraceExporter } from './trace-exporter';
import { CloudWatchLogExporter } from './log-exporter';
import { CloudWatchMetricExporter } from './metric-exporter';
import { signCloudWatchOtlpRequest } from './sigv4';

vi.mock('./sigv4', () => ({
  signCloudWatchOtlpRequest: vi.fn(async () => ({
    authorization: 'AWS4-HMAC-SHA256 ...',
    'content-type': 'application/json',
  })),
}));

vi.mock('@opentelemetry/otlp-transformer', () => ({
  JsonTraceSerializer: {
    serializeRequest: vi.fn(() => Uint8Array.from([1, 2, 3])),
  },
  JsonLogsSerializer: {
    serializeRequest: vi.fn(() => Uint8Array.from([4, 5, 6])),
  },
  JsonMetricsSerializer: {
    serializeRequest: vi.fn(() => Uint8Array.from([7, 8, 9])),
  },
}));

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '',
  } as Response;
}

function badResponse(body = 'bad'): Response {
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: async () => body,
  } as Response;
}

async function runExport(
  run: (callback: (code: ExportResultCode, error?: Error) => void) => void,
): Promise<{ code: ExportResultCode; error?: Error }> {
  return new Promise((resolve) => {
    run((code, error) => resolve({ code, error }));
  });
}

describe('cloudwatch exporters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trace exporter posts signed payload to traces endpoint', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const exporter = new CloudWatchTraceExporter({
      region: 'us-west-2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    });

    const result = await runExport((done) => {
      exporter.export([{} as never], ({ code, error }) => done(code, error));
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(signCloudWatchOtlpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'traces',
        region: 'us-west-2',
        url: 'https://xray.us-west-2.amazonaws.com/v1/traces',
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://xray.us-west-2.amazonaws.com/v1/traces',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: expect.any(String),
        }),
      }),
    );
  });

  it('log exporter sends required CloudWatch log headers to signer', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const exporter = new CloudWatchLogExporter({
      region: 'us-west-2',
      logGroup: '/aws/lambda/my-fn',
      logStream: '2026/05/19/[$LATEST]abc',
      truncatableFields: 'body.message',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    });

    const result = await runExport((done) => {
      exporter.export([{} as never], ({ code, error }) => done(code, error));
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(signCloudWatchOtlpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'logs',
        url: 'https://logs.us-west-2.amazonaws.com/v1/logs',
        additionalHeaders: {
          'x-aws-log-group': '/aws/lambda/my-fn',
          'x-aws-log-stream': '2026/05/19/[$LATEST]abc',
          'x-aws-truncatable-fields': 'body.message',
        },
      }),
    );
  });

  it('metric exporter defaults to DELTA temporality and posts to metrics endpoint', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const exporter = new CloudWatchMetricExporter({
      region: 'us-west-2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    });

    const temporality = exporter.selectAggregationTemporality('COUNTER' as never);
    expect(temporality).toBe(AggregationTemporality.DELTA);

    const result = await runExport((done) => {
      exporter.export({} as never, ({ code, error }) => done(code, error));
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(signCloudWatchOtlpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'metrics',
        url: 'https://monitoring.us-west-2.amazonaws.com/v1/metrics',
      }),
    );
  });

  it('returns FAILED when upstream returns non-2xx', async () => {
    const fetchImpl = vi.fn(async () => badResponse('upstream says no'));
    const exporter = new CloudWatchTraceExporter({
      region: 'us-west-2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    });

    const result = await runExport((done) => {
      exporter.export([{} as never], ({ code, error }) => done(code, error));
    });

    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(result.error?.message).toContain('HTTP 400');
    expect(result.error?.message).toContain('upstream says no');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPExporter, retryAfterMs } from './exporter';

const fetchMock = vi.fn<typeof fetch>();

function exportOnce(): Promise<ExportResult> {
  const exporter = new OTLPExporter({
    url: 'https://collector.example/v1/traces',
  });
  return new Promise((resolve) => exporter.export([], resolve));
}

const reply = (
  status: number,
  init: { body?: string; headers?: Record<string, string> } = {},
) => new Response(init.body ?? null, { status, headers: init.headers });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(promise: Promise<ExportResult>): Promise<ExportResult> {
  await vi.runAllTimersAsync();
  return promise;
}

describe('OTLPExporter delivery', () => {
  it('retries a 503 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(200));
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(reply(200));
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it.each([400, 500])('sends a batch answered %i once', async (status) => {
    fetchMock.mockResolvedValue(reply(status));
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts', async () => {
    fetchMock.mockResolvedValue(reply(503));
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('waits a short Retry-After and fails a long one at once', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, { headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(reply(200));
    const pending = exportOnce();
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = await settle(pending);
    expect(first.code).toBe(ExportResultCode.SUCCESS);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      reply(429, { headers: { 'retry-after': '60' } }),
    );
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails a 2xx whose partialSuccess rejected spans, without retrying', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        body: JSON.stringify({
          partialSuccess: { rejectedSpans: '2', errorMessage: 'bad' },
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await settle(exportOnce());
    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(result.error?.message).toContain('rejected 2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(
      retryAfterMs(new Date(Date.now() + 10_000).toUTCString()),
    ).toBeGreaterThan(5000);
    expect(retryAfterMs('later')).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { TelemetryBackend } from 'autotel-mcp';
import {
  buildProbeSpan,
  encodeProbe,
  measureFreshness,
  otlpHeadersFromEnv,
  resolveOtlpTraceUrl,
  sendOtlpTrace,
} from './freshness';

/** A backend that starts empty and serves the probe from the Nth read onward. */
function backendVisibleFromRead(n: number): {
  backend: TelemetryBackend;
  reads: () => number;
} {
  let reads = 0;
  const backend = {
    searchTraces: async () => {
      reads++;
      return reads >= n
        ? { items: [{ traceId: 'probe' }], totalCount: 1 }
        : { items: [], totalCount: 0 };
    },
  } as unknown as TelemetryBackend;
  return { backend, reads: () => reads };
}

/** A clock that advances a fixed step per call, so elapsed time is exact. */
function steppedClock(startMs: number, stepMs: number): () => number {
  let current = startMs - stepMs;
  return () => {
    current += stepMs;
    return current;
  };
}

const noSleep = async () => {};

describe('measureFreshness', () => {
  it('reports the lag once the probe span becomes queryable', async () => {
    const { backend } = backendVisibleFromRead(3);
    let currentMs = 1_000_000;
    const result = await measureFreshness({
      backend,
      otlpEndpoint: 'http://localhost:4318',
      now: () => currentMs,
      sleep: async (ms) => {
        currentMs += ms;
      },
      send: async () => {},
    });

    expect(result.timedOut).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.timeToQueryableSeconds).toBe(4);
  });

  it('writes the probe under the service name it then polls for', async () => {
    const { backend } = backendVisibleFromRead(1);
    const send = vi.fn(async () => {});
    const result = await measureFreshness({
      backend,
      otlpEndpoint: 'http://localhost:4318',
      sleep: noSleep,
      send,
    });

    const [endpoint, span] = send.mock.calls[0] as unknown as [
      string,
      ReturnType<typeof buildProbeSpan>,
    ];
    expect(endpoint).toBe('http://localhost:4318');
    expect(span.resource.attributes['service.name']).toBe(result.probeService);
  });

  it('gives up at the timeout instead of polling forever', async () => {
    const neverVisible = {
      searchTraces: async () => ({ items: [], totalCount: 0 }),
    } as unknown as TelemetryBackend;

    const result = await measureFreshness({
      backend: neverVisible,
      otlpEndpoint: 'http://localhost:4318',
      timeoutMs: 10_000,
      now: steppedClock(0, 2000),
      sleep: noSleep,
      send: async () => {},
    });

    expect(result.timedOut).toBe(true);
    expect(result.timeToQueryableSeconds).toBeNull();
    expect(result.attempts).toBeLessThan(10);
  });

  it('surfaces backend read failures instead of disguising them as stale data', async () => {
    const unauthorized = {
      searchTraces: async () => {
        throw new Error('401 Unauthorized');
      },
    } as unknown as TelemetryBackend;

    await expect(
      measureFreshness({
        backend: unauthorized,
        otlpEndpoint: 'http://localhost:4318',
        sleep: noSleep,
        send: async () => {},
      }),
    ).rejects.toThrow(/401/);
  });

  it('bounds a backend read that never settles', async () => {
    const hanging = {
      searchTraces: async () => new Promise(() => {}),
    } as unknown as TelemetryBackend;

    const result = await measureFreshness({
      backend: hanging,
      otlpEndpoint: 'http://localhost:4318',
      timeoutMs: 10,
      pollIntervalMs: 1,
      send: async () => {},
    });

    expect(result.timedOut).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('surfaces a rejected probe write instead of reporting a false timeout', async () => {
    const { backend } = backendVisibleFromRead(1);
    await expect(
      measureFreshness({
        backend,
        otlpEndpoint: 'http://localhost:4318',
        sleep: noSleep,
        send: async () => {
          throw new Error('OTLP endpoint rejected the probe span: 404');
        },
      }),
    ).rejects.toThrow(/probe span/);
  });
});

describe('otlpHeadersFromEnv', () => {
  it('parses the standard comma-separated OTLP header env var', () => {
    expect(otlpHeadersFromEnv('Authorization=token,x-scope=team')).toEqual({
      Authorization: 'token',
      'x-scope': 'team',
    });
  });

  it('tolerates padding around keys and values', () => {
    expect(otlpHeadersFromEnv(' Authorization = token ')).toEqual({
      Authorization: 'token',
    });
  });

  // A bearer value can itself contain '=' padding; only the first separator counts.
  it('splits on the first equals only', () => {
    expect(otlpHeadersFromEnv('Authorization=Basic dXNlcjpwYXNz==')).toEqual({
      Authorization: 'Basic dXNlcjpwYXNz==',
    });
  });

  it('returns nothing for an unset or empty value', () => {
    // Typed as possibly-undefined to mirror a missing env var.
    const unset: string | undefined = process.env.DEFINITELY_NOT_SET_ABC123;
    expect(otlpHeadersFromEnv(unset)).toEqual({});
    expect(otlpHeadersFromEnv('')).toEqual({});
    expect(otlpHeadersFromEnv('   ')).toEqual({});
  });

  it('skips malformed entries rather than emitting a blank header', () => {
    expect(otlpHeadersFromEnv('good=1,broken,=2')).toEqual({ good: '1' });
  });
});

describe('probe authentication', () => {
  it('sends the configured headers with the probe write', async () => {
    const { backend } = backendVisibleFromRead(1);
    const send = vi.fn(async () => {});
    await measureFreshness({
      backend,
      otlpEndpoint: 'https://logfire-eu.pydantic.dev',
      headers: { Authorization: 'write-token' },
      sleep: noSleep,
      send,
    });

    const call = send.mock.calls[0] as unknown as [
      string,
      unknown,
      Record<string, string>,
    ];
    expect(call[2]).toEqual({ Authorization: 'write-token' });
  });
});

describe('resolveOtlpTraceUrl', () => {
  it('appends the trace path without discarding a vendor base path', () => {
    expect(
      resolveOtlpTraceUrl('https://cloud.langfuse.com/api/public/otel'),
    ).toBe('https://cloud.langfuse.com/api/public/otel/v1/traces');
    expect(resolveOtlpTraceUrl('https://grafana.example.com/otlp')).toBe(
      'https://grafana.example.com/otlp/v1/traces',
    );
  });

  it('does not append the trace path twice', () => {
    expect(resolveOtlpTraceUrl('http://localhost:4318/v1/traces')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('is used by the real probe sender', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchSpy);

    await sendOtlpTrace(
      'https://cloud.langfuse.com/api/public/otel',
      buildProbeSpan('probe', 1_700_000_000_000),
    );

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://cloud.langfuse.com/api/public/otel/v1/traces',
    );
    vi.unstubAllGlobals();
  });
});

describe('buildProbeSpan', () => {
  it('produces a finished span with distinct random ids', () => {
    const span = buildProbeSpan('svc', 1_700_000_000_000);
    const context = span.spanContext();

    expect(span.resource.attributes['service.name']).toBe('svc');
    expect(context.traceId).toHaveLength(32);
    expect(context.spanId).toHaveLength(16);
    expect(span.startTime).toEqual([1_700_000_000, 0]);
    // A zero-length span is legal but reads oddly, so the probe has duration.
    expect(span.endTime[1]).toBeGreaterThan(span.startTime[1]);
    expect(buildProbeSpan('svc', 0).spanContext().traceId).not.toBe(
      context.traceId,
    );
  });
});

describe('encodeProbe', () => {
  it('encodes protobuf by default with the matching content type', () => {
    const { body, contentType } = encodeProbe(
      buildProbeSpan('probe-svc', 1_700_000_000_000),
      'protobuf',
    );

    expect(contentType).toBe('application/x-protobuf');
    expect(body.length).toBeGreaterThan(0);
    // Protobuf keeps the service name as raw bytes, not JSON.
    expect(Buffer.from(body).includes('probe-svc')).toBe(true);
    expect(() => JSON.parse(Buffer.from(body).toString('utf8'))).toThrow();
  });

  it('encodes spec-shaped JSON when asked, for receivers that need it', () => {
    const { body, contentType } = encodeProbe(
      buildProbeSpan('probe-svc', 1_700_000_000_000),
      'json',
    );

    expect(contentType).toBe('application/json');
    const payload = JSON.parse(Buffer.from(body).toString('utf8'));
    expect(payload.resourceSpans[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'probe-svc' },
    });
  });
});

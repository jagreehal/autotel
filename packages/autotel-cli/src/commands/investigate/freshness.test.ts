import { describe, expect, it, vi } from 'vitest';
import type { TelemetryBackend } from 'autotel-mcp';
import {
  buildProbeSpan,
  encodeProbe,
  measureFreshness,
  otlpHeadersFromEnv,
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
    const result = await measureFreshness({
      backend,
      otlpEndpoint: 'http://localhost:4318',
      now: steppedClock(1_000_000, 500),
      sleep: noSleep,
      send: async () => {},
    });

    expect(result.timedOut).toBe(false);
    expect(result.attempts).toBe(3);
    // Clock ticks at 500ms: start, timeout check after poll 1, after poll 2,
    // then the read-back once poll 3 finds it → 1.5s elapsed.
    expect(result.timeToQueryableSeconds).toBe(1.5);
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

  it('keeps waiting when a read throws rather than failing the measurement', async () => {
    let reads = 0;
    const flaky = {
      searchTraces: async () => {
        reads++;
        if (reads === 1) throw new Error('unknown service');
        return { items: [{ traceId: 'probe' }], totalCount: 1 };
      },
    } as unknown as TelemetryBackend;

    const result = await measureFreshness({
      backend: flaky,
      otlpEndpoint: 'http://localhost:4318',
      sleep: noSleep,
      send: async () => {},
    });

    expect(result.timedOut).toBe(false);
    expect(result.attempts).toBe(2);
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

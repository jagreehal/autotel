import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { readableSpanDouble } from './testing/doubles';
import {
  createTraceExporter,
  formatEndpointUrl,
  resolveProtocol,
} from './init';

/**
 * Protocol selection and endpoint formatting, tested against the real exports.
 *
 * The encoding tests hit a local HTTP server rather than mocking the exporter,
 * because the defect they guard is the wire format itself: `protocol: 'http'`
 * resolves to `@opentelemetry/exporter-trace-otlp-http`, which serializes JSON.
 * A vendor that accepts only OTLP protobuf (Logfire, PostHog) then silently
 * receives nothing. Only a real request proves which encoding went out.
 */

interface CapturedRequest {
  contentType: string | undefined;
  bytes: number;
}

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
});

/** Start a throwaway OTLP receiver that records what it was sent. */
async function captureOtlpRequest(): Promise<{
  url: string;
  next: () => Promise<CapturedRequest>;
}> {
  const captured: CapturedRequest[] = [];
  const waiters: Array<(request: CapturedRequest) => void> = [];

  const listener = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry: CapturedRequest = {
        contentType: request.headers['content-type'],
        bytes: Buffer.concat(chunks).length,
      };
      const waiter = waiters.shift();
      if (waiter) waiter(entry);
      else captured.push(entry);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
  });
  server = listener;

  await new Promise<void>((resolve) =>
    listener.listen(0, '127.0.0.1', resolve),
  );
  // SAFETY: address() answers with an AddressInfo for a listening TCP server,
  // and this one was just awaited into listening. The string form is for Unix
  // sockets, which this test never opens.
  const { port } = listener.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1/traces`,
    next: () =>
      new Promise<CapturedRequest>((resolve) => {
        const ready = captured.shift();
        if (ready) resolve(ready);
        else waiters.push(resolve);
      }),
  };
}

/** Minimal finished span the OTLP serializers accept. */
function probeSpan(): ReadableSpan {
  return readableSpanDouble({
    name: 'protocol-probe',
    kind: 0,
    spanContext: () => ({
      traceId: '0'.repeat(31) + '1',
      spanId: '0'.repeat(15) + '1',
      traceFlags: 1,
    }),
    parentSpanContext: undefined,
    startTime: [1_785_500_000, 0],
    endTime: [1_785_500_000, 1_000_000],
    duration: [0, 1_000_000],
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    ended: true,
    resource: { attributes: { 'service.name': 'probe' } },
    instrumentationScope: { name: 'protocol-test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  });
}

async function exportOneSpan(
  protocol: 'http' | 'http/protobuf',
  url: string,
): Promise<void> {
  const exporter = createTraceExporter(protocol, { url });
  await new Promise<void>((resolve) => {
    exporter.export([probeSpan()], () => resolve());
  });
}

function withEnvProtocol<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  if (value === undefined) delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  else process.env.OTEL_EXPORTER_OTLP_PROTOCOL = value;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
    } else {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = previous;
    }
  }
}

describe('resolveProtocol', () => {
  it('passes an explicit config protocol through', () => {
    expect(resolveProtocol('grpc')).toBe('grpc');
    expect(resolveProtocol('http')).toBe('http');
    expect(resolveProtocol('http/protobuf')).toBe('http/protobuf');
  });

  it('defaults to http when nothing is configured', () => {
    withEnvProtocol(undefined, () => {
      expect(resolveProtocol()).toBe('http');
    });
  });

  // The OTel spec defines http/protobuf as protobuf-encoded. Mapping it onto the
  // JSON exporter, as this previously did, silently gave anyone who set the
  // standard variable the wrong encoding.
  it('honours the standard OTEL_EXPORTER_OTLP_PROTOCOL values', () => {
    withEnvProtocol('http/protobuf', () =>
      expect(resolveProtocol()).toBe('http/protobuf'),
    );
    withEnvProtocol('http/json', () => expect(resolveProtocol()).toBe('http'));
    withEnvProtocol('grpc', () => expect(resolveProtocol()).toBe('grpc'));
  });

  it('lets an explicit config protocol win over the environment', () => {
    withEnvProtocol('grpc', () =>
      expect(resolveProtocol('http/protobuf')).toBe('http/protobuf'),
    );
  });

  it('falls back to http for an unrecognised value', () => {
    withEnvProtocol('invalid', () => expect(resolveProtocol()).toBe('http'));
    withEnvProtocol('', () => expect(resolveProtocol()).toBe('http'));
  });
});

describe('formatEndpointUrl', () => {
  it('appends the signal path for HTTP protocols', () => {
    expect(formatEndpointUrl('http://localhost:4318', 'traces', 'http')).toBe(
      'http://localhost:4318/v1/traces',
    );
    expect(
      formatEndpointUrl('http://localhost:4318', 'metrics', 'http/protobuf'),
    ).toBe('http://localhost:4318/v1/metrics');
  });

  it('does not double-append a path that is already there', () => {
    expect(
      formatEndpointUrl('http://localhost:4318/v1/traces', 'traces', 'http'),
    ).toBe('http://localhost:4318/v1/traces');
  });

  // PostHog serves OTLP under /i, so the vendor prefix has to survive.
  it('preserves a vendor path prefix', () => {
    expect(
      formatEndpointUrl(
        'https://eu.i.posthog.com/i',
        'traces',
        'http/protobuf',
      ),
    ).toBe('https://eu.i.posthog.com/i/v1/traces');
  });

  it('strips signal paths for gRPC, which addresses the base endpoint', () => {
    expect(formatEndpointUrl('api.honeycomb.io:443', 'traces', 'grpc')).toBe(
      'api.honeycomb.io:443',
    );
    expect(
      formatEndpointUrl('api.example.com/v1/traces', 'traces', 'grpc'),
    ).toBe('api.example.com');
  });
});

describe('createTraceExporter wire encoding', () => {
  it('sends protobuf when the protocol is http/protobuf', async () => {
    const { url, next } = await captureOtlpRequest();
    await exportOneSpan('http/protobuf', url);
    const request = await next();

    expect(request.contentType).toContain('application/x-protobuf');
    expect(request.bytes).toBeGreaterThan(0);
  });

  it('still sends JSON for plain http, so existing setups are unchanged', async () => {
    const { url, next } = await captureOtlpRequest();
    await exportOneSpan('http', url);
    const request = await next();

    expect(request.contentType).toContain('application/json');
  });
});

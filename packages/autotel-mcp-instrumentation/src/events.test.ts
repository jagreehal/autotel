/**
 * MCP Events against the real 2026-07-28 SDK, end to end. The SDK has no
 * Events API, so the server registers `events/*` the way an Events server
 * must, with `setRequestHandler(method, schemas, handler)`, and the client
 * sends them with `request()`. Spans are read back from both ends.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { metrics, SpanKind, trace, type Attributes } from '@opentelemetry/api';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { z } from 'zod';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { instrumentMcpServer } from './server';
import { instrumentMcpClient, processEvent } from './client';
import { injectOtelContextToMeta } from './context';

let collector: TraceCollector;
/** Every metric recording, as `[instrument, value, attributes]`. */
const recorded: Array<[string, number, Attributes | undefined]> = [];
beforeAll(() => {
  // The instruments are created lazily and cached, so the provider has to be
  // in place before the first recording.
  const instrument = (name: string) => {
    const record = (value: number, attributes?: Attributes) =>
      recorded.push([name, value, attributes]);
    return { add: record, record };
  };
  metrics.setGlobalMeterProvider({
    getMeter: () =>
      // SAFETY: the code under test calls only createCounter and
      // createHistogram, and records through add/record.
      ({
        createCounter: instrument,
        createHistogram: instrument,
      }) as never,
  });
});
beforeEach(() => {
  collector = createTraceCollector();
  recorded.length = 0;
});

const Occurrence = z.looseObject({
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()),
  cursor: z.string().nullable().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
const PollParams = z.looseObject({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  cursor: z.string().nullable(),
});
const PollResult = z.looseObject({
  events: z.array(Occurrence),
  cursor: z.string().nullable(),
  truncated: z.boolean().optional(),
  hasMore: z.boolean().optional(),
  nextPollMs: z.number().optional(),
});

/** The trace that caused the upstream event, as a server would know it. */
const UPSTREAM = '4bf92f3577b34da6a3ce929d0e0e4736';
const upstreamMeta = {
  traceparent: `00-${UPSTREAM}-00f067aa0ba902b7-01`,
};

/** An occurrence as the tests send it: every field SEP-3415 requires. */
type TestOccurrence = {
  eventId: string;
  name: string;
  timestamp: string;
  data: { incidentId: string; severity: string };
  _meta?: Record<string, string>;
};

const occurrence = (id: string, meta?: Record<string, string>) => {
  const event: TestOccurrence = {
    eventId: id,
    name: 'incident.opened',
    timestamp: new Date(Date.now() - 2000).toISOString(),
    data: { incidentId: 'inc_1', severity: 'P1' },
  };
  if (meta) event._meta = meta;
  return event;
};

async function connect() {
  const server = instrumentMcpServer(
    new McpServer({ name: 'events-server', version: '1.0.0' }),
    {},
  );
  const low = server.server;
  low.setRequestHandler(
    'events/poll',
    { params: PollParams, result: PollResult },
    async (params: z.infer<typeof PollParams>) => {
      if (params.name !== 'incident.opened') {
        throw Object.assign(new Error('Unknown event'), { code: -32_602 });
      }
      return params.cursor === null
        ? { events: [], cursor: 'c1', nextPollMs: 1000 }
        : {
            events: [occurrence('evt_1', upstreamMeta)],
            cursor: 'c2',
            truncated: true,
            hasMore: false,
          };
    },
  );
  low.setRequestHandler(
    'events/stream',
    { params: PollParams, result: z.looseObject({}) },
    async (params: z.infer<typeof PollParams>, ctx: any) => {
      if (params.name === 'broken') throw new Error('upstream unavailable');
      await ctx.mcpReq.notify({
        method: 'notifications/events/active',
        params: { cursor: 'c1', truncated: false },
      });
      await ctx.mcpReq.notify({
        method: 'notifications/events/event',
        params: { ...occurrence('evt_2'), cursor: 'c2' },
      });
      return { resultType: 'complete' };
    },
  );

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = instrumentMcpClient(
    new Client({ name: 'agent', version: '1.0.0' }),
    {},
  );
  await client.connect(clientSide);
  return client;
}

// SAFETY: the SDK validates the response against PollResult.
const poll = (client: Client, name: string, cursor: string | null) =>
  client.request(
    { method: 'events/poll', params: { name, cursor } },
    PollResult,
  ) as Promise<z.infer<typeof PollResult>>;

describe('MCP Events', () => {
  it('traces a poll on both ends, in one trace, with what it returned', async () => {
    const client = await connect();
    const first = await poll(client, 'incident.opened', null);
    expect(first.events).toEqual([]);
    const second = await poll(client, 'incident.opened', 'c1');
    expect(second.events).toHaveLength(1);

    const [clientEmpty, clientFull] = collector
      .getSpansByName('events/poll incident.opened')
      .filter((s) => s.kind === SpanKind.CLIENT);
    const servers = collector
      .getSpansByName('events/poll incident.opened')
      .filter((s) => s.kind === SpanKind.SERVER);
    expect(servers).toHaveLength(2);
    expect(clientEmpty!.attributes).toMatchObject({
      'mcp.method.name': 'events/poll',
      'mcp.event.name': 'incident.opened',
      'mcp.event.delivery': 'poll',
      'mcp.event.count': 0,
    });
    expect(clientFull!.attributes).toMatchObject({
      'mcp.event.count': 1,
      'mcp.event.truncated': true,
      'mcp.event.has_more': false,
    });
    // The server span is the client span's child: `_meta` carried the context.
    const serverFull = servers.find((s) => s.traceId === clientFull!.traceId);
    expect(serverFull?.parentSpanId).toBe(clientFull!.spanId);
    // Payloads are untrusted and never recorded.
    expect(JSON.stringify(collector.getSpans())).not.toContain('inc_1');
  });

  it('links the reaction to the trace that caused the event, not the poll', async () => {
    const client = await connect();
    const { events } = await poll(client, 'incident.opened', 'c1');
    const reacted = await processEvent(events[0]!, () => 'handled');
    expect(reacted).toBe('handled');

    const span = collector.expectSpan('process incident.opened');
    expect(span.kind).toBe(SpanKind.CONSUMER);
    expect(span.attributes).toMatchObject({
      'mcp.event.name': 'incident.opened',
      'mcp.event.id': 'evt_1',
      'mcp.event.delivery': 'poll',
    });
    expect(span.links.map((l) => l.context.traceId)).toEqual([UPSTREAM]);
    expect(span.traceId).not.toBe(UPSTREAM);
  });

  it('keeps an unknown event name off the span name', async () => {
    const client = await connect();
    await expect(poll(client, 'made.up', null)).rejects.toThrow();
    const failed = collector
      .getSpansByName('events/poll')
      .find((s) => s.kind === SpanKind.SERVER);
    expect(failed?.status.code).toBe(2);
    expect(failed?.attributes['error.type']).toBeDefined();
  });

  it('traces a push stream as an opening span plus one span per occurrence', async () => {
    const client = await connect();
    const received: string[] = [];
    let processSpanTrace: string | undefined;
    client.setNotificationHandler(
      'notifications/events/event',
      { params: Occurrence },
      async (params: z.infer<typeof Occurrence>) => {
        received.push(params.eventId);
        processSpanTrace = trace.getActiveSpan()?.spanContext().traceId;
      },
    );
    await client.request(
      {
        method: 'events/stream',
        params: { name: 'incident.opened', cursor: null },
      },
      z.looseObject({}),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(['evt_2']);

    const open = collector.expectSpan({
      name: 'events/stream incident.opened',
      kind: SpanKind.SERVER,
    });
    expect(open.attributes).toMatchObject({
      'mcp.event.delivery': 'push',
      'mcp.event.truncated': false,
    });
    const send = collector.expectSpan('send incident.opened');
    expect(send.kind).toBe(SpanKind.PRODUCER);
    expect(send.parentSpanId).toBe(open.spanId);
    // No upstream trace on this occurrence, so the client links to the send.
    const process = collector.expectSpan('process incident.opened');
    expect(process.attributes['mcp.event.delivery']).toBe('push');
    expect(process.links.map((l) => l.context.spanId)).toEqual([send.spanId]);
    expect(processSpanTrace).toBe(process.traceId);
  });

  it('records a webhook delivery with the receiver calling processEvent', async () => {
    const body = occurrence('evt_3', { ...injectOtelContextToMeta() });
    await processEvent(body, async () => {}, { delivery: 'webhook' });
    expect(
      collector.expectSpan('process incident.opened').attributes[
        'mcp.event.delivery'
      ],
    ).toBe('webhook');
  });

  it('ends a stream span that fails before it confirms, with the error', async () => {
    const client = await connect();
    await expect(
      client.request(
        { method: 'events/stream', params: { name: 'broken', cursor: null } },
        z.looseObject({}),
      ),
    ).rejects.toThrow();
    const open = collector
      .getSpansByName('events/stream')
      .find((s) => s.kind === SpanKind.SERVER);
    expect(open?.status.code).toBe(2);
    expect(open?.attributes['error.type']).toBe('Error');
  });

  it('counts deliveries, receipts, lag and gaps without the event id', async () => {
    const client = await connect();
    await poll(client, 'incident.opened', 'c1');

    const named = (instrument: string) =>
      recorded.filter(([name]) => name === instrument);
    expect(named('mcp.server.event.delivered')).toEqual([
      [
        'mcp.server.event.delivered',
        1,
        { 'mcp.event.name': 'incident.opened', 'mcp.event.delivery': 'poll' },
      ],
    ]);
    expect(named('mcp.client.event.received')).toHaveLength(1);
    const lag = named('mcp.client.event.lag')[0]?.[1];
    expect(lag).toBeGreaterThanOrEqual(2);
    expect(named('mcp.client.event.gaps')).toHaveLength(1);
    expect(JSON.stringify(recorded)).not.toContain('evt_1');
  });
});

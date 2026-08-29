import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { foldWebMcpTools } from '../webmcp-aggregator';
import { DevtoolsServer } from '../server';
import type { SpanAttributes, TraceData } from '../../widget/types';

let devtools: DevtoolsServer | undefined;

afterEach(async () => {
  await devtools?.close();
  devtools = undefined;
});

let seq = 0;

function span(
  name: string,
  attributes: SpanAttributes,
  over: { startTime?: number; error?: boolean } = {},
) {
  seq += 1;
  const startTime = over.startTime ?? 1_000 + seq;
  return {
    traceId: `trace-${seq}`,
    spanId: `span-${seq}`,
    name,
    kind: 'INTERNAL' as const,
    startTime,
    endTime: startTime + 1,
    duration: 1,
    attributes,
    status: { code: over.error ? ('ERROR' as const) : ('OK' as const) },
  };
}

/** One trace per fold input; the fold only cares about the spans inside. */
function trace(spans: ReturnType<typeof span>[], service = 'shop'): TraceData {
  return {
    traceId: spans[0]?.traceId ?? 'trace-empty',
    correlationId: 'c',
    rootSpan: spans[0],
    spans,
    startTime: spans[0]?.startTime ?? 0,
    endTime: spans.at(-1)?.endTime ?? 0,
    duration: 1,
    status: 'OK',
    service,
  } as TraceData;
}

const install = (id: string) =>
  span('webmcp.install', { 'webmcp.installation.id': id });

const register = (name: string, id: string, attrs: SpanAttributes = {}) =>
  span('webmcp.tool.register', {
    'webmcp.installation.id': id,
    'webmcp.tool.name': name,
    'webmcp.tool.has_input_schema': true,
    ...attrs,
  });

const execute = (
  name: string,
  id: string,
  attrs: SpanAttributes = {},
  error = false,
) =>
  span(
    'webmcp.tool.execute',
    {
      'webmcp.installation.id': id,
      'webmcp.tool.name': name,
      'webmcp.result.bytes': 13,
      ...attrs,
    },
    { error },
  );

const withdraw = (name: string, id: string) =>
  span('webmcp.tool.withdraw', {
    'webmcp.installation.id': id,
    'webmcp.tool.name': name,
  });

const at = <T extends ReturnType<typeof span>>(
  value: T,
  startTime: number,
): T => ({ ...value, startTime, endTime: startTime + value.duration }) as T;

describe('foldWebMcpTools', () => {
  it('reports a withdrawn tool as no longer offered', () => {
    const { tools } = foldWebMcpTools([
      trace([
        install('a'),
        register('checkout', 'a'),
        withdraw('checkout', 'a'),
      ]),
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'checkout', offered: false });
  });

  it('offers a tool again when a `when:` gate re-registers it', () => {
    const { tools } = foldWebMcpTools([
      trace([
        install('a'),
        register('checkout', 'a'),
        withdraw('checkout', 'a'),
        register('checkout', 'a'),
      ]),
    ]);

    expect(tools[0].offered).toBe(true);
  });

  it('keeps two page loads apart, so a removed tool does not read as offered', () => {
    // A reload withdraws nothing: without the installation id these two would
    // fold into one record and `search` would still look available.
    const { tools, summary } = foldWebMcpTools([
      trace([install('first'), register('search', 'first')]),
      trace([install('second'), register('checkout', 'second')]),
    ]);

    expect(summary.installations).toBe(2);
    expect(tools.map((t) => `${t.name}@${t.installationId}`).sort()).toEqual([
      'checkout@second',
      'search@first',
    ]);
  });

  it('marks a tool seen only in executions rather than assuming it is clean', () => {
    const { tools } = foldWebMcpTools([trace([execute('search', 'a')])]);

    expect(tools[0]).toMatchObject({
      name: 'search',
      observedAtRegistration: false,
      offered: false,
      annotationsDropped: [],
    });
  });

  it('counts an installation that registered nothing', () => {
    const { summary } = foldWebMcpTools([
      trace([install('late')]),
      trace([install('ok'), register('search', 'ok')]),
    ]);

    expect(summary.emptyInstallations).toBe(1);
  });

  it('carries the annotations the browser dropped', () => {
    const { tools, summary } = foldWebMcpTools([
      trace([
        register('checkout', 'a', {
          'webmcp.annotations.sent': 'readOnlyHint,destructiveHint',
          'webmcp.annotations.dropped': 'destructiveHint',
        }),
      ]),
    ]);

    expect(tools[0].annotationsSent).toEqual([
      'readOnlyHint',
      'destructiveHint',
    ]);
    expect(tools[0].annotationsDropped).toEqual(['destructiveHint']);
    expect(summary.toolsWithDroppedAnnotations).toBe(1);
  });

  it('totals what the results cost, and what the envelope costs on top', () => {
    const { tools, summary } = foldWebMcpTools([
      trace([
        register('search', 'a'),
        execute('search', 'a', {
          'webmcp.result.bytes': 45,
          'webmcp.result.envelope': true,
        }),
        execute('search', 'a', {
          'webmcp.result.bytes': 45,
          'webmcp.result.envelope': true,
        }),
        execute('search', 'a', { 'webmcp.result.bytes': 13 }),
      ]),
    ]);

    expect(tools[0].calls).toBe(3);
    expect(tools[0].envelopeCalls).toBe(2);
    expect(tools[0].resultBytes).toBe(103);
    expect(tools[0].medianResultBytes).toBe(45);
    expect(tools[0].envelopeBytes).toBe(64);
    expect(summary.envelopeBytes).toBe(64);
  });

  it('counts a failure from either the span status or the result attribute', () => {
    const { tools } = foldWebMcpTools([
      trace([
        register('checkout', 'a'),
        execute('checkout', 'a', {}, true),
        execute('checkout', 'a', { 'webmcp.result.error': true }),
        execute('checkout', 'a'),
      ]),
    ]);

    expect(tools[0]).toMatchObject({ calls: 3, errors: 2 });
  });

  it('bounds recent calls and returns them newest first', () => {
    const calls = Array.from({ length: 8 }, (_, i) =>
      execute('search', 'a', { 'webmcp.result.bytes': i }, false),
    );
    const { tools } = foldWebMcpTools([
      trace([register('search', 'a'), ...calls]),
    ]);

    expect(tools[0].recentCalls).toHaveLength(5);
    const timestamps = tools[0].recentCalls.map((c) => c.timestamp);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it('sorts offered tools above withdrawn ones', () => {
    const { tools } = foldWebMcpTools([
      trace([
        register('gone', 'a'),
        withdraw('gone', 'a'),
        register('here', 'a'),
        execute('here', 'a'),
      ]),
    ]);

    expect(tools.map((t) => t.name)).toEqual(['here', 'gone']);
  });

  it('keeps spans from an older instrumentation readable as one installation', () => {
    const { tools, summary } = foldWebMcpTools([
      trace([
        span('webmcp.tool.register', { 'webmcp.tool.name': 'search' }),
        span('webmcp.tool.execute', {
          'webmcp.tool.name': 'search',
          'webmcp.result.bytes': 10,
        }),
      ]),
    ]);

    expect(summary.installations).toBe(1);
    expect(tools).toHaveLength(1);
    expect(tools[0].installationId).toBe('unknown');
  });

  it('ignores spans that are not WebMCP', () => {
    const { tools, summary } = foldWebMcpTools([
      trace([span('GET /orders', { 'http.route': '/orders' })]),
    ]);

    expect(tools).toEqual([]);
    expect(summary.installations).toBe(0);
  });
});

describe('DevtoolsServer.queryWebMcp', () => {
  it('uses the newest lifecycle event when spans arrive in separate traces', () => {
    devtools = new DevtoolsServer({ server: createServer() });
    devtools.addTrace(trace([register('checkout', 'a')], 'shop'));
    devtools.addTrace(trace([withdraw('checkout', 'a')], 'shop'));

    expect(devtools.queryWebMcp({}).webmcp.tools[0]?.offered).toBe(false);
  });

  it('counts tools as currently offered only in the latest installation', () => {
    devtools = new DevtoolsServer({ server: createServer() });
    devtools.addTrace(trace([install('old')]));
    devtools.addTrace(trace([register('search', 'old')]));
    devtools.addTrace(trace([install('current')]));
    devtools.addTrace(trace([register('checkout', 'current')]));

    const inventory = devtools.queryWebMcp({}).webmcp;

    expect(inventory.summary.toolsOffered).toBe(1);
    expect(
      inventory.tools.find((tool) => tool.name === 'search')?.offered,
    ).toBe(false);
    expect(
      inventory.tools.find((tool) => tool.name === 'checkout')?.offered,
    ).toBe(true);
  });

  it('uses lifecycle history before the window without counting old calls', () => {
    devtools = new DevtoolsServer({ server: createServer() });
    devtools.addTrace(trace([at(install('a'), 100)]));
    devtools.addTrace(trace([at(register('checkout', 'a'), 110)]));
    devtools.addTrace(trace([at(execute('checkout', 'a'), 150)]));
    devtools.addTrace(trace([at(execute('checkout', 'a'), 250)]));

    const tool = devtools.queryWebMcp({
      window: { start: 200, end: 300 },
    }).webmcp.tools[0];

    expect(tool).toMatchObject({
      name: 'checkout',
      observedAtRegistration: true,
      offered: true,
      calls: 1,
    });
  });
});

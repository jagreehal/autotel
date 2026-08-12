// Shared story/test fixtures for spans and traces.
//
// Exists so story files stop each re-declaring their own `makeTrace`: when the
// shapes drifted per file, a story could show a trace the app can never
// produce. One builder, one shape.

import type { SpanData, SpanNode, TraceData } from '../../types';

const T0 = 1_760_000_000_000;

export function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    name: 'GET /quote',
    kind: 'SERVER',
    startTime: T0,
    endTime: T0 + 120,
    duration: 120,
    attributes: {
      'http.request.method': 'GET',
      'http.route': '/quote',
      'http.response.status_code': 200,
    },
    status: { code: 'OK' },
    ...overrides,
  };
}

/** A trace whose children are real spans, so waterfall stories have depth. */
export function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  const root = makeSpan();
  const child = makeSpan({
    spanId: 'span-2',
    parentSpanId: 'span-1',
    name: 'carrier.quote',
    kind: 'CLIENT',
    startTime: T0 + 10,
    endTime: T0 + 100,
    duration: 90,
  });

  return {
    traceId: root.traceId,
    correlationId: root.traceId.slice(0, 16),
    rootSpan: root,
    spans: [root, child],
    startTime: root.startTime,
    endTime: root.endTime,
    duration: root.duration,
    status: 'OK',
    service: 'carrier-gateway',
    ...overrides,
  };
}

/** A failing trace — the state most stories actually need to show. */
export function makeFailedTrace(): TraceData {
  const trace = makeTrace();
  const root = makeSpan({
    status: { code: 'ERROR', message: 'carrier returned 401' },
    attributes: {
      ...makeSpan().attributes,
      'http.response.status_code': 401,
    },
  });
  return { ...trace, rootSpan: root, spans: [root], status: 'ERROR' };
}

export function makeSpanNode(span: SpanData = makeSpan()): SpanNode {
  return { span, children: [], depth: 0 };
}

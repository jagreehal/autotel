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

/**
 * A batch send: five sibling spans that share one name and differ in the
 * attributes the app set (`user.id`, `statements.outcome`), plus resource and
 * auto-instrumentation attributes.
 */
export function makeBatchSendTrace(): TraceData {
  const auto = {
    'service.name': 'statements-worker',
    'deployment.environment': 'dev',
    'deployment.environment.name': 'dev',
    'telemetry.sdk.language': 'nodejs',
  };
  const root = makeSpan({
    spanId: 'send',
    name: 'statements.send',
    kind: 'INTERNAL',
    duration: 200,
    endTime: T0 + 200,
    status: { code: 'ERROR', message: '1 of 5 sends failed' },
    attributes: {
      ...auto,
      'code.function': 'send',
      'statements.batch_id': 'b-17',
      'statements.count': 5,
    },
  });
  const users = [
    ['u1', 'invited', 80],
    ['u2', 'invited', 99],
    ['u3', 'invited', 70],
    ['u4', 'send_failed', 156],
    ['u5', 'invited', 60],
  ] as const;
  const children = users.map(([user, outcome, duration], i) => {
    const attributes: SpanData['attributes'] = {
      ...auto,
      'code.function': 'sendUser',
      'user.id': user,
      'statements.outcome': outcome,
    };
    if (outcome === 'send_failed') attributes['error.type'] = 'SmtpError';
    return makeSpan({
      spanId: `send-${user}`,
      parentSpanId: 'send',
      name: 'statements.send_user',
      kind: 'INTERNAL',
      startTime: T0 + i * 5,
      endTime: T0 + i * 5 + duration,
      duration,
      status:
        outcome === 'send_failed'
          ? { code: 'ERROR', message: 'SMTP 550 mailbox unavailable' }
          : { code: 'OK' },
      attributes,
    });
  });
  return {
    traceId: root.traceId,
    correlationId: root.traceId,
    rootSpan: root,
    spans: [root, ...children],
    startTime: T0,
    endTime: T0 + 200,
    duration: 200,
    status: 'ERROR',
    service: 'statements-worker',
  };
}

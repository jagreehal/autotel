import type { TraceData, SpanData, LogData, MetricData } from '../../types';

export function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  const traceId = overrides.traceId ?? 'trace-1';
  const spanId = overrides.spanId ?? 'span-1';
  return {
    traceId,
    spanId,
    name: overrides.name ?? 'GET /api/users',
    kind: overrides.kind ?? 'SERVER',
    startTime: overrides.startTime ?? 100,
    endTime: overrides.endTime ?? 200,
    duration: overrides.duration ?? 100,
    attributes: overrides.attributes ?? { 'http.method': 'GET' },
    status: overrides.status ?? { code: 'OK' },
    events: overrides.events ?? [],
    parentSpanId: overrides.parentSpanId,
  };
}

export function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  const traceId = overrides.traceId ?? 'trace-1';
  const rootSpan = overrides.rootSpan ?? makeSpan({ traceId });
  return {
    traceId,
    correlationId: overrides.correlationId ?? `corr-${traceId}`,
    rootSpan,
    spans: overrides.spans ?? [rootSpan],
    startTime: overrides.startTime ?? 100,
    endTime: overrides.endTime ?? 200,
    duration: overrides.duration ?? 100,
    status: overrides.status ?? 'OK',
    service: overrides.service ?? 'test-service',
  };
}

export function makeLog(overrides: Partial<LogData> = {}): LogData {
  return {
    id: overrides.id ?? 'log-1',
    body: overrides.body ?? 'test log message',
    timestamp: overrides.timestamp ?? Date.now(),
    traceId: overrides.traceId,
    spanId: overrides.spanId,
    resourceName: overrides.resourceName,
    severityText: overrides.severityText,
    severityNumber: overrides.severityNumber,
    attributes: overrides.attributes,
    resource: overrides.resource,
  };
}

export function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return {
    type: overrides.type ?? 'event',
    name: overrides.name ?? 'user.signup',
    value: overrides.value,
    attributes: overrides.attributes ?? {},
    timestamp: overrides.timestamp ?? Date.now(),
    traceId: overrides.traceId,
  };
}

export function makeTraceWithSpans(
  traceId: string,
  spanNames: string[],
  overrides: Partial<TraceData> = {},
): TraceData {
  const spans = spanNames.map((name, index) =>
    makeSpan({
      traceId,
      spanId: `${traceId}-span-${index}`,
      name,
      parentSpanId: index === 0 ? undefined : `${traceId}-span-0`,
    }),
  );

  return makeTrace({
    traceId,
    spans,
    rootSpan: spans[0],
    ...overrides,
  });
}

export function makeErrorTrace(
  traceId: string,
  errorMessage: string,
): TraceData {
  return makeTrace({
    traceId,
    status: 'ERROR',
    rootSpan: makeSpan({
      traceId,
      status: { code: 'ERROR', message: errorMessage },
      events: [
        {
          name: 'exception',
          timestamp: 150,
          attributes: {
            'exception.type': 'Error',
            'exception.message': errorMessage,
          },
        },
      ],
    }),
  });
}

// Devtools' trace and log shapes → the issue core's inputs. One mapping, used
// by both the issue engine (stored issues) and the Errors-tab aggregator
// (live groups), so the two cannot disagree about what a failure is.

import type { IssueLogInput, IssueSpanInput } from '../issues';
import type { LogData, SpanData, TraceData } from './types';

function serviceOf(span: SpanData, trace: TraceData): string {
  const own = span.attributes['service.name'];
  return typeof own === 'string' && own !== '' ? own : trace.service;
}

export function traceToIssueSpans(trace: TraceData): IssueSpanInput[] {
  return trace.spans.map((span) => ({
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    service: serviceOf(span, trace),
    startTime: span.startTime,
    status: span.status.code,
    statusMessage: span.status.message,
    attributes: span.attributes,
    events: span.events,
  }));
}

export function logToIssueLog(log: LogData): IssueLogInput {
  return {
    id: log.id,
    traceId: log.traceId,
    service: log.resourceName ?? 'unknown',
    severityText: log.severityText,
    severityNumber: log.severityNumber,
    body: typeof log.body === 'string' ? log.body : JSON.stringify(log.body),
    timestamp: log.timestamp,
    attributes: log.attributes,
  };
}

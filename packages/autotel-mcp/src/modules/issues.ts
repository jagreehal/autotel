/**
 * Issues over any backend: an adapter from autotel-mcp's records to the shared
 * issue core in `autotel-devtools/issues`, so a failure gets the same
 * fingerprint here, in the devtools Issues view, and in its Errors tab.
 *
 * A backend that keeps issue state (devtools) answers `listIssues` itself,
 * with status; anything else is grouped from the failing traces and error
 * logs in the window, and every issue reads as `active`.
 */

import {
  groupOccurrences,
  occurrenceFromLog,
  occurrenceFromTrace,
  type Issue,
  type IssueSpanInput,
  type IssueStatus,
  type Occurrence,
} from 'autotel-devtools/issues';
import type { LogRecord, SpanRecord, TraceRecord } from '../types';
import type { TelemetryBackend } from '../backends/telemetry';
import { compactTrace } from './trace-payload';

export type { Issue, IssueStatus };

function spanInput(span: SpanRecord): IssueSpanInput {
  const statusMessage = span.tags['otel.status_description'];
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.operationName,
    service: span.serviceName,
    startTime: span.startTimeUnixMs,
    status: span.statusCode,
    ...(typeof statusMessage === 'string' ? { statusMessage } : {}),
    // Backends flatten the `exception` event into tags; the core reads both.
    attributes: span.tags,
  };
}

export function occurrencesOf(
  traces: TraceRecord[],
  logs: LogRecord[],
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const trace of traces) {
    const occurrence = occurrenceFromTrace(
      trace.traceId,
      trace.spans.map(spanInput),
    );
    if (occurrence) out.push(occurrence);
  }
  for (const [index, log] of logs.entries()) {
    const occurrence = occurrenceFromLog({
      id: `${log.timestampUnixMs}-${index}`,
      traceId: log.traceId,
      service: log.serviceName ?? 'unknown',
      severityText: log.severityText,
      body: log.body,
      timestamp: log.timestampUnixMs,
      attributes: log.attributes,
    });
    if (occurrence) out.push(occurrence);
  }
  return out;
}

export interface LoadIssuesQuery {
  service?: string;
  lookbackMinutes: number;
  quietMinutes: number;
  /** `all` (default) or one status. */
  status?: IssueStatus | 'all';
  nowUnixMs?: number;
}

export interface LoadIssuesResult {
  issues: Issue[];
  /** Where the answer came from: stored issue state, or grouped just now. */
  source: 'stored' | 'computed';
}

export async function loadIssues(
  backend: TelemetryBackend,
  query: LoadIssuesQuery,
): Promise<LoadIssuesResult> {
  const end = query.nowUnixMs ?? Date.now();
  const start = end - query.lookbackMinutes * 60_000;
  const quietMs = query.quietMinutes * 60_000;
  const wanted = (issue: Issue) =>
    !query.status || query.status === 'all' || issue.status === query.status;

  const stored = await backend.listIssues?.({
    service: query.service,
    start,
    end,
    quietMs,
  });
  if (stored) return { issues: stored.filter(wanted), source: 'stored' };

  const range = { startTimeUnixMs: start, endTimeUnixMs: end };
  const [failed, withExceptions, logs] = await Promise.all([
    backend.searchTraces({
      service: query.service,
      hasError: true,
      limit: 500,
      ...range,
    }),
    // Successful traces that still recorded an exception: handled errors
    // (`console.error(err)`), log floods, runaway alarms. A backend that
    // cannot filter on it contributes nothing rather than failing the call.
    backend
      .searchTraces({
        service: query.service,
        filters: [{ field: 'exception.type', operator: 'exists' }],
        limit: 500,
        ...range,
      })
      .catch(() => ({ items: [] as TraceRecord[] })),
    backend.capabilities().logs === 'available'
      ? backend.searchLogs({
          serviceName: query.service,
          limit: 1000,
          ...range,
        })
      : Promise.resolve({ items: [] as LogRecord[] }),
  ]);
  const traces = [
    ...new Map(
      [...failed.items, ...withExceptions.items].map((t) => [t.traceId, t]),
    ).values(),
  ];
  return {
    issues: groupOccurrences(occurrencesOf(traces, logs.items), {
      start,
      end,
      quietMs,
    }).filter(wanted),
    source: 'computed',
  };
}

/** What a fixer needs for one issue: stack, latest trace and its logs, nearby logs. */
export async function issueContext(
  backend: TelemetryBackend,
  issue: Issue,
  contextSeconds = 30,
) {
  const traceId = issue.sampleTraceIds[0];
  const [correlated, around] = await Promise.all([
    traceId ? backend.getCorrelatedSignals(traceId) : undefined,
    backend.capabilities().logs === 'available'
      ? backend.searchLogs({
          serviceName: issue.service,
          startTimeUnixMs: issue.lastSeen - contextSeconds * 1000,
          endTimeUnixMs: issue.lastSeen + contextSeconds * 1000,
          limit: 100,
        })
      : undefined,
  ]);
  return {
    issue,
    latestOccurrence: correlated?.trace
      ? { trace: compactTrace(correlated.trace), logs: correlated.logs }
      : null,
    surroundingLogs: around?.items ?? [],
  };
}

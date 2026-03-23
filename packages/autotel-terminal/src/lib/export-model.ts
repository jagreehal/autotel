import type { TraceSummary } from './trace-model';
import type { TerminalLogEvent } from './log-model';

export interface ExportedTrace {
  traceId: string;
  rootName: string;
  durationMs: number;
  lastEndTime: number;
  spans: Array<{
    name: string;
    spanId: string;
    parentSpanId?: string;
    startTime: number;
    endTime: number;
    durationMs: number;
    status: string;
    kind?: string;
    attributes?: Record<string, unknown>;
  }>;
  logs: Array<{
    time: number;
    level: string;
    message: string;
    traceId?: string;
    spanId?: string;
    attributes?: Record<string, unknown>;
  }>;
}

export function exportTraceToJson(
  trace: TraceSummary,
  logs: TerminalLogEvent[],
): string {
  const exported: ExportedTrace = {
    traceId: trace.traceId,
    rootName: trace.rootName,
    durationMs: trace.durationMs,
    lastEndTime: trace.lastEndTime,
    spans: trace.spans.map((s) => ({
      name: s.name,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMs: s.durationMs,
      status: s.status,
      kind: s.kind,
      attributes: s.attributes,
    })),
    logs: logs.map((l) => ({
      time: l.time,
      level: l.level,
      message: l.message,
      traceId: l.traceId,
      spanId: l.spanId,
      attributes: l.attributes,
    })),
  };

  return JSON.stringify(exported, null, 2);
}

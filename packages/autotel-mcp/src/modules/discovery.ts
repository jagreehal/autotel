import type {
  LogRecord,
  MetricSeries,
  SpanRecord,
  TagValue,
  TraceRecord,
} from '../types';

export interface FieldDiscovery {
  totalFields: number;
  fieldsByType: Record<string, string[]>;
  searchableFields: string[];
  fieldDetails: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    occurrences: number;
    examples: Array<string | number | boolean>;
  }>;
}

export interface ServiceDiscoveryItem {
  name: string;
  signals: {
    traces: boolean;
    logs: boolean;
    metrics: boolean;
  };
  stats: {
    traces: number;
    spans: number;
    errorSpans: number;
    logs: number;
    metrics: number;
  };
  operations: string[];
  metricNames: string[];
  logSeverities: string[];
  languages: string[];
}

interface FieldAggregate {
  type: 'string' | 'number' | 'boolean';
  occurrences: number;
  examples: Array<string | number | boolean>;
}

const MAX_EXAMPLES_PER_FIELD = 3;

export function discoverTraceFields(
  traces: TraceRecord[],
  search?: string,
): FieldDiscovery {
  const fields = new Map<string, FieldAggregate>();

  for (const trace of traces) {
    const spanCount = trace.spans.length;
    const errorCount = trace.spans.filter((span) => span.hasError).length;
    const totalTokens = sumTraceTokens(trace);

    addField(fields, 'trace_id', trace.traceId);
    addField(fields, 'trace.span_count', spanCount);
    addField(fields, 'trace.error_count', errorCount);
    addField(
      fields,
      'trace.llm_span_count',
      trace.spans.filter(isLLMSpan).length,
    );
    addField(fields, 'trace.total_tokens', totalTokens);

    for (const span of trace.spans) {
      collectSpanFields(fields, span);
    }
  }

  return finalizeFieldDiscovery(fields, search);
}

export function discoverLogFields(
  logs: LogRecord[],
  search?: string,
): FieldDiscovery {
  const fields = new Map<string, FieldAggregate>();

  for (const log of logs) {
    addField(fields, 'timestamp_unix_ms', log.timestampUnixMs);
    addField(fields, 'severity_text', log.severityText);
    addField(fields, 'body', log.body);
    if (log.serviceName) addField(fields, 'service.name', log.serviceName);
    if (log.traceId) addField(fields, 'trace_id', log.traceId);
    if (log.spanId) addField(fields, 'span_id', log.spanId);

    for (const [key, value] of Object.entries(log.attributes ?? {})) {
      addField(fields, key, value);
    }
  }

  return finalizeFieldDiscovery(fields, search);
}

export function discoverServices(params: {
  services: string[];
  traces: TraceRecord[];
  logs: LogRecord[];
  metrics: MetricSeries[];
}): ServiceDiscoveryItem[] {
  const byService = new Map<string, ServiceDiscoveryItem>();

  const ensureService = (name: string): ServiceDiscoveryItem => {
    const existing = byService.get(name);
    if (existing) return existing;
    const created: ServiceDiscoveryItem = {
      name,
      signals: {
        traces: false,
        logs: false,
        metrics: false,
      },
      stats: {
        traces: 0,
        spans: 0,
        errorSpans: 0,
        logs: 0,
        metrics: 0,
      },
      operations: [],
      metricNames: [],
      logSeverities: [],
      languages: [],
    };
    byService.set(name, created);
    return created;
  };

  for (const service of params.services) {
    ensureService(service);
  }

  for (const trace of params.traces) {
    const touched = new Set<string>();
    for (const span of trace.spans) {
      const svc = ensureService(span.serviceName);
      svc.signals.traces = true;
      svc.stats.spans += 1;
      if (span.hasError) svc.stats.errorSpans += 1;
      touched.add(span.serviceName);

      if (!svc.operations.includes(span.operationName)) {
        svc.operations.push(span.operationName);
      }

      const language = extractLanguage(span.tags);
      if (language && !svc.languages.includes(language)) {
        svc.languages.push(language);
      }
    }
    for (const serviceName of touched) {
      ensureService(serviceName).stats.traces += 1;
    }
  }

  for (const log of params.logs) {
    if (!log.serviceName) continue;
    const svc = ensureService(log.serviceName);
    svc.signals.logs = true;
    svc.stats.logs += 1;
    if (log.severityText && !svc.logSeverities.includes(log.severityText)) {
      svc.logSeverities.push(log.severityText);
    }
  }

  for (const series of params.metrics) {
    const serviceName =
      readAttrString(series.attributes, 'service.name') ??
      readAttrString(series.attributes, 'serviceName');
    if (!serviceName) continue;
    const svc = ensureService(serviceName);
    svc.signals.metrics = true;
    svc.stats.metrics += 1;
    if (!svc.metricNames.includes(series.metricName)) {
      svc.metricNames.push(series.metricName);
    }
  }

  for (const item of byService.values()) {
    item.operations.sort();
    item.metricNames.sort();
    item.logSeverities.sort();
    item.languages.sort();
  }

  return [...byService.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectSpanFields(
  fields: Map<string, FieldAggregate>,
  span: SpanRecord,
) {
  addField(fields, 'trace_id', span.traceId);
  addField(fields, 'span_id', span.spanId);
  if (span.parentSpanId) addField(fields, 'parent_span_id', span.parentSpanId);
  addField(fields, 'service.name', span.serviceName);
  addField(fields, 'operation_name', span.operationName);
  addField(fields, 'duration_ms', span.durationMs);
  addField(fields, 'status_code', span.statusCode);
  addField(fields, 'has_error', span.hasError);

  for (const [key, value] of Object.entries(span.tags)) {
    addField(fields, key, value);
  }
}

function addField(
  fields: Map<string, FieldAggregate>,
  name: string,
  value: TagValue,
): void {
  const type = typeof value;
  if (type !== 'string' && type !== 'number' && type !== 'boolean') return;

  const current = fields.get(name);
  if (!current) {
    fields.set(name, {
      type,
      occurrences: 1,
      examples: [value],
    });
    return;
  }

  current.occurrences += 1;
  if (
    current.examples.length < MAX_EXAMPLES_PER_FIELD &&
    !current.examples.includes(value)
  ) {
    current.examples.push(value);
  }
}

function finalizeFieldDiscovery(
  fields: Map<string, FieldAggregate>,
  search?: string,
): FieldDiscovery {
  const matcher = search ? buildWildcardMatcher(search) : null;

  const entries = [...fields.entries()]
    .filter(([name]) => (matcher ? matcher(name) : true))
    .sort((a, b) => a[0].localeCompare(b[0]));

  const fieldsByType: Record<string, string[]> = {
    string: [],
    number: [],
    boolean: [],
  };

  const fieldDetails = entries.map(([name, agg]) => {
    fieldsByType[agg.type].push(name);
    return {
      name,
      type: agg.type,
      occurrences: agg.occurrences,
      examples: agg.examples,
    };
  });

  return {
    totalFields: entries.length,
    fieldsByType,
    searchableFields: entries.map(([name]) => name),
    fieldDetails,
  };
}

function buildWildcardMatcher(pattern: string): (field: string) => boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const re = new RegExp(`^${escaped}$`, 'i');
  return (field: string) => re.test(field);
}

function sumTraceTokens(trace: TraceRecord): number {
  let total = 0;
  for (const span of trace.spans) {
    const token =
      asNumber(span.tags['gen_ai.usage.total_tokens']) ??
      asNumber(span.tags['llm.token_count.total']) ??
      0;
    total += token;
  }
  return total;
}

function isLLMSpan(span: SpanRecord): boolean {
  return Boolean(
    span.tags['gen_ai.system'] ??
    span.tags['gen_ai.request.model'] ??
    span.tags['gen_ai.response.model'] ??
    span.tags['llm.provider'] ??
    span.tags['llm.model'],
  );
}

function asNumber(value: TagValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractLanguage(tags: Record<string, TagValue>): string | undefined {
  const bySemantic = readTagString(tags['telemetry.sdk.language']);
  if (bySemantic) return bySemantic;
  const runtime = readTagString(tags['process.runtime.name']);
  if (!runtime) return undefined;
  return runtime.toLowerCase();
}

function readTagString(value: TagValue | undefined): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function readAttrString(
  attrs: Record<string, TagValue> | undefined,
  key: string,
): string | undefined {
  const value = attrs?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

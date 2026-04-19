import type {
  FilterOperator,
  QueryFilter,
  SpanRecord,
  SpanSearchQuery,
  TagValue,
  TraceRecord,
  TraceSearchQuery,
} from '../types';

function matchesTagValue(
  actual: TagValue | undefined,
  expected: TagValue,
): boolean {
  if (actual === undefined) return false;
  return actual === expected;
}

function matchesAllTags(
  tags: Record<string, TagValue>,
  expectedTags: Record<string, TagValue>,
): boolean {
  return Object.entries(expectedTags).every(([key, value]) =>
    matchesTagValue(tags[key], value),
  );
}

export function spanMatchesQuery(
  span: SpanRecord,
  query: SpanSearchQuery | TraceSearchQuery,
): boolean {
  if (query.service && span.serviceName !== query.service) {
    return false;
  }

  if (query.operation && span.operationName !== query.operation) {
    return false;
  }

  if (query.hasError && !span.hasError) {
    return false;
  }

  if (query.statusCode && span.statusCode !== query.statusCode) {
    return false;
  }

  if (
    query.minDurationMs !== undefined &&
    span.durationMs < query.minDurationMs
  ) {
    return false;
  }

  if (
    query.maxDurationMs !== undefined &&
    span.durationMs > query.maxDurationMs
  ) {
    return false;
  }

  if (query.tags && !matchesAllTags(span.tags, query.tags)) {
    return false;
  }

  if (query.filters && !matchesGenericFilters(span, query.filters)) {
    return false;
  }

  return true;
}

export function traceMatchesQuery(
  trace: TraceRecord,
  query: TraceSearchQuery,
): boolean {
  const traceDurationMs = deriveTraceDurationMs(trace.spans);

  if (
    query.minDurationMs !== undefined &&
    traceDurationMs < query.minDurationMs
  ) {
    return false;
  }

  if (
    query.maxDurationMs !== undefined &&
    traceDurationMs > query.maxDurationMs
  ) {
    return false;
  }

  const traceStatusCode = deriveTraceStatusCode(trace.spans);
  if (query.statusCode && traceStatusCode !== query.statusCode) {
    return false;
  }

  if (query.hasError && !trace.spans.some((span) => span.hasError)) {
    return false;
  }

  if (query.filters && !matchesGenericFilters(trace, query.filters)) {
    return false;
  }

  if (!query.service && !query.operation && !query.tags) {
    return true;
  }

  // Strip filters before per-span check — they were already evaluated at trace level
  const spanQuery = query.filters ? { ...query, filters: undefined } : query;
  return trace.spans.some((span) => spanMatchesQuery(span, spanQuery));
}

function deriveTraceStatusCode(
  spans: SpanRecord[],
): TraceSearchQuery['statusCode'] {
  if (spans.some((span) => span.statusCode === 'ERROR')) return 'ERROR';
  if (spans.some((span) => span.statusCode === 'OK')) return 'OK';
  return 'UNSET';
}

function deriveTraceDurationMs(spans: SpanRecord[]): number {
  if (spans.length === 0) return 0;
  const start = Math.min(...spans.map((s) => s.startTimeUnixMs));
  const end = Math.max(...spans.map((s) => s.startTimeUnixMs + s.durationMs));
  return end - start;
}

export function matchesGenericFilters(
  item: SpanRecord | TraceRecord,
  filters: QueryFilter[],
): boolean {
  return filters.every((filter) => matchesQueryFilter(item, filter));
}

function matchesQueryFilter(
  item: SpanRecord | TraceRecord,
  filter: QueryFilter,
): boolean {
  const values = getValuesForField(item, filter.field);
  if (filter.operator === 'exists') return values.length > 0;
  if (filter.operator === 'not_exists') return values.length === 0;
  if (values.length === 0) return false;

  const negative = new Set<FilterOperator>([
    'not_equals',
    'not_contains',
    'not_in',
  ]);
  if (negative.has(filter.operator)) {
    return values.every((value) => compareValue(value, filter));
  }
  return values.some((value) => compareValue(value, filter));
}

function compareValue(actual: TagValue, filter: QueryFilter): boolean {
  const rawValue = filter.value;
  const expected = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const expectedValues: TagValue[] = Array.isArray(rawValue)
    ? rawValue
    : rawValue !== undefined
      ? [rawValue]
      : [];
  switch (filter.valueType) {
    case 'number': {
      const actualNum = toNumber(actual);
      const expectedNum =
        expected !== undefined && expected !== null
          ? toNumber(expected as TagValue)
          : undefined;
      const valuesNum = expectedValues
        .map((v) => toNumber(v as TagValue))
        .filter((v): v is number => v !== undefined);
      if (actualNum === undefined) return false;
      return compareNumeric(actualNum, filter.operator, expectedNum, valuesNum);
    }
    case 'boolean': {
      const actualBool = toBoolean(actual);
      const expectedBool =
        expected !== undefined && expected !== null
          ? toBoolean(expected as TagValue)
          : undefined;
      if (actualBool === undefined || expectedBool === undefined) return false;
      return compareBoolean(actualBool, filter.operator, expectedBool);
    }
    case 'string':
    default: {
      const actualStr = String(actual);
      const expectedStr =
        expected !== undefined && expected !== null ? String(expected) : '';
      const valuesStr = expectedValues.map((v) => String(v));
      return compareString(actualStr, filter.operator, expectedStr, valuesStr);
    }
  }
}

function compareNumeric(
  actual: number,
  operator: FilterOperator,
  expected: number | undefined,
  expectedValues: number[],
): boolean {
  switch (operator) {
    case 'equals':
      return expected !== undefined && actual === expected;
    case 'not_equals':
      return expected !== undefined && actual !== expected;
    case 'gt':
      return expected !== undefined && actual > expected;
    case 'lt':
      return expected !== undefined && actual < expected;
    case 'gte':
      return expected !== undefined && actual >= expected;
    case 'lte':
      return expected !== undefined && actual <= expected;
    case 'in':
      return expectedValues.includes(actual);
    case 'not_in':
      return !expectedValues.includes(actual);
    case 'between':
      return (
        expectedValues.length === 2 &&
        actual >= expectedValues[0]! &&
        actual <= expectedValues[1]!
      );
    default:
      return false;
  }
}

function compareBoolean(
  actual: boolean,
  operator: FilterOperator,
  expected: boolean,
): boolean {
  if (operator === 'equals') return actual === expected;
  if (operator === 'not_equals') return actual !== expected;
  return false;
}

function compareString(
  actual: string,
  operator: FilterOperator,
  expected: string,
  expectedValues: string[],
): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'not_contains':
      return !actual.includes(expected);
    case 'starts_with':
      return actual.startsWith(expected);
    case 'ends_with':
      return actual.endsWith(expected);
    case 'in':
      return expectedValues.includes(actual);
    case 'not_in':
      return !expectedValues.includes(actual);
    default:
      return false;
  }
}

function getValuesForField(
  item: SpanRecord | TraceRecord,
  field: string,
): TagValue[] {
  if ('spanId' in item) {
    return getSpanFieldValues(item, field);
  }
  return getTraceFieldValues(item, field);
}

function getTraceFieldValues(trace: TraceRecord, field: string): TagValue[] {
  const values: TagValue[] = [];
  const normalized = normalizeField(field);
  if (normalized === 'trace_id') values.push(trace.traceId);
  if (normalized === 'service_name') {
    const rootSpan = trace.spans.find((s) => !s.parentSpanId) ?? trace.spans[0];
    if (rootSpan) values.push(rootSpan.serviceName);
  }
  if (normalized === 'duration' || normalized === 'duration_ms')
    values.push(deriveTraceDurationMs(trace.spans));
  if (normalized === 'status' || normalized === 'status_code') {
    const code = deriveTraceStatusCode(trace.spans);
    if (code) values.push(code);
  }
  if (normalized === 'span_count') values.push(trace.spans.length);
  if (normalized === 'error_count')
    values.push(trace.spans.filter((span) => span.hasError).length);
  if (normalized === 'llm_span_count')
    values.push(trace.spans.filter(isLLMSpan).length);
  if (normalized === 'total_tokens') values.push(sumTraceTokens(trace));
  for (const span of trace.spans) {
    values.push(...getSpanFieldValues(span, field));
  }
  return values;
}

function getSpanFieldValues(span: SpanRecord, field: string): TagValue[] {
  const values: TagValue[] = [];
  const normalized = normalizeField(field);
  if (normalized === 'trace_id') values.push(span.traceId);
  if (normalized === 'span_id') values.push(span.spanId);
  if (normalized === 'parent_span_id' && span.parentSpanId)
    values.push(span.parentSpanId);
  if (normalized === 'service_name') values.push(span.serviceName);
  if (
    normalized === 'operation_name' ||
    normalized === 'span_name' ||
    normalized === 'name'
  )
    values.push(span.operationName);
  if (normalized === 'duration' || normalized === 'duration_ms')
    values.push(span.durationMs);
  if (normalized === 'status' || normalized === 'status_code')
    values.push(span.statusCode);
  if (normalized === 'has_error') values.push(span.hasError);
  if (normalized === 'llm_span' || normalized === 'is_llm_span')
    values.push(isLLMSpan(span));
  if (normalized === 'gen_ai_system') values.push(getSpanSystem(span) ?? '');
  if (normalized === 'gen_ai_request_model')
    values.push(getSpanRequestModel(span) ?? '');
  if (normalized === 'gen_ai_response_model')
    values.push(getSpanResponseModel(span) ?? '');
  if (normalized === 'total_tokens') values.push(getSpanTotalTokens(span));
  for (const [key, value] of Object.entries(span.tags)) {
    if (normalizeField(key) === normalized) values.push(value);
  }
  return values.filter(
    (value) => value !== '' && value !== undefined,
  ) as TagValue[];
}

function normalizeField(field: string): string {
  return field.replace(/\./g, '_').toLowerCase();
}

function isLLMSpan(span: SpanRecord): boolean {
  return getSpanSystem(span) !== undefined;
}

function getSpanSystem(span: SpanRecord): string | undefined {
  const system = span.tags['gen_ai.system'] ?? span.tags['llm.vendor'];
  return typeof system === 'string' ? system : undefined;
}

function getSpanRequestModel(span: SpanRecord): string | undefined {
  const model =
    span.tags['gen_ai.request.model'] ?? span.tags['llm.request.model'];
  return typeof model === 'string' ? model : undefined;
}

function getSpanResponseModel(span: SpanRecord): string | undefined {
  const model =
    span.tags['gen_ai.response.model'] ?? span.tags['llm.response.model'];
  return typeof model === 'string' ? model : undefined;
}

function getSpanTotalTokens(span: SpanRecord): number {
  return (
    asNumber(span.tags['gen_ai.usage.total_tokens']) ??
    asNumber(span.tags['llm.usage.total_tokens']) ??
    asNumber(span.tags['gen_ai.usage.prompt_tokens']) ??
    asNumber(span.tags['gen_ai.usage.input_tokens']) ??
    asNumber(span.tags['llm.usage.prompt_tokens']) ??
    asNumber(span.tags['llm.usage.input_tokens']) ??
    0
  );
}

function sumTraceTokens(trace: TraceRecord): number {
  return trace.spans.reduce((sum, span) => sum + getSpanTotalTokens(span), 0);
}

function asNumber(value: TagValue | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toNumber(
  value: string | number | boolean | null | undefined,
): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBoolean(
  value: string | number | boolean | null | undefined,
): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

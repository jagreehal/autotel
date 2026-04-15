import { z } from 'zod';
import type {
  TraceSearchQuery,
  SpanSearchQuery,
  MetricSearchQuery,
  LogSearchQuery,
} from '../types.js';

export function respondJSON(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export const tagValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const filterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'in',
    'not_in',
    'gt',
    'lt',
    'gte',
    'lte',
    'between',
    'exists',
    'not_exists',
  ]),
  valueType: z.enum(['string', 'number', 'boolean']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const traceQuerySchema = z.object({
  serviceName: z.string().min(1).optional(),
  operationName: z.string().min(1).optional(),
  lookbackMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
  limit: z.number().int().positive().max(100).optional(),
  errorOnly: z.boolean().optional(),
  statusCode: z.enum(['OK', 'ERROR', 'UNSET']).optional(),
  minDurationMs: z.number().int().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
  genAiSystem: z.string().min(1).optional(),
  genAiRequestModel: z.string().min(1).optional(),
  genAiResponseModel: z.string().min(1).optional(),
  tags: z.record(tagValueSchema).optional(),
  filters: z.array(filterSchema).optional(),
});

export type TraceQueryInput = z.infer<typeof traceQuerySchema>;
export type SpanQueryInput = TraceQueryInput & {
  minDurationMs?: number;
  maxDurationMs?: number;
};
export type MetricsQueryInput = {
  metricName?: string;
  serviceName?: string;
  lookbackMinutes?: number;
  limit?: number;
};
export type LogsQueryInput = {
  serviceName?: string;
  traceId?: string;
  spanId?: string;
  severityText?: string;
  text?: string;
  lookbackMinutes?: number;
  limit?: number;
  attributes?: Record<string, string | number | boolean>;
};

export function toTraceSearchQuery(input: TraceQueryInput): TraceSearchQuery {
  const query: TraceSearchQuery = {};
  if (input.serviceName !== undefined) query.service = input.serviceName;
  if (input.operationName !== undefined) query.operation = input.operationName;
  if (input.lookbackMinutes !== undefined) {
    const nowMs = Date.now();
    query.startTimeUnixMs = nowMs - input.lookbackMinutes * 60 * 1000;
    query.endTimeUnixMs = nowMs;
  }
  if (input.limit !== undefined) query.limit = input.limit;
  if (input.errorOnly !== undefined) query.hasError = input.errorOnly;
  if (input.statusCode !== undefined) query.statusCode = input.statusCode;
  if (input.minDurationMs !== undefined)
    query.minDurationMs = input.minDurationMs;
  if (input.maxDurationMs !== undefined)
    query.maxDurationMs = input.maxDurationMs;
  if (input.genAiSystem !== undefined) {
    query.tags = { ...(query.tags ?? {}), 'gen_ai.system': input.genAiSystem };
  }
  if (input.genAiRequestModel !== undefined) {
    query.tags = {
      ...(query.tags ?? {}),
      'gen_ai.request.model': input.genAiRequestModel,
    };
  }
  if (input.genAiResponseModel !== undefined) {
    query.tags = {
      ...(query.tags ?? {}),
      'gen_ai.response.model': input.genAiResponseModel,
    };
  }
  if (input.tags !== undefined)
    query.tags = { ...(query.tags ?? {}), ...input.tags };
  if (input.filters !== undefined)
    query.filters = sanitizeFilters(input.filters);
  return query;
}

export function toSpanSearchQuery(input: SpanQueryInput): SpanSearchQuery {
  return {
    ...toTraceSearchQuery(input),
    ...(input.minDurationMs !== undefined
      ? { spanMinDurationMs: input.minDurationMs }
      : {}),
    ...(input.maxDurationMs !== undefined
      ? { spanMaxDurationMs: input.maxDurationMs }
      : {}),
  };
}

export function toMetricSearchQuery(
  input: MetricsQueryInput,
): MetricSearchQuery {
  const query: MetricSearchQuery = {};
  if (input.metricName !== undefined) query.metricName = input.metricName;
  if (input.serviceName !== undefined) query.serviceName = input.serviceName;
  if (input.lookbackMinutes !== undefined)
    query.lookbackMinutes = input.lookbackMinutes;
  if (input.limit !== undefined) query.limit = input.limit;
  return query;
}

export function toLogSearchQuery(input: LogsQueryInput): LogSearchQuery {
  const query: LogSearchQuery = {};
  if (input.serviceName !== undefined) query.serviceName = input.serviceName;
  if (input.traceId !== undefined) query.traceId = input.traceId;
  if (input.spanId !== undefined) query.spanId = input.spanId;
  if (input.severityText !== undefined) query.severityText = input.severityText;
  if (input.text !== undefined) query.text = input.text;
  if (input.lookbackMinutes !== undefined) {
    const nowMs = Date.now();
    query.startTimeUnixMs = nowMs - input.lookbackMinutes * 60 * 1000;
    query.endTimeUnixMs = nowMs;
  }
  if (input.limit !== undefined) query.limit = input.limit;
  if (input.attributes !== undefined) query.attributes = input.attributes;
  return query;
}

function sanitizeFilters(
  filters: z.infer<typeof filterSchema>[],
): NonNullable<TraceSearchQuery['filters']> {
  return filters.map((filter) => {
    const sanitized: NonNullable<TraceSearchQuery['filters']>[number] = {
      field: filter.field,
      operator: filter.operator,
      valueType: filter.valueType,
    };
    if (filter.value !== undefined) sanitized.value = filter.value;
    if (filter.values !== undefined) sanitized.value = filter.values;
    return sanitized;
  });
}

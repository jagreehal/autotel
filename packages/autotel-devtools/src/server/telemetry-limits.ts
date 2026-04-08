import type { DevtoolsData } from './types'

export interface TelemetryLimits {
  maxTraceCount: number
  maxLogCount: number
  maxMetricCount: number
}

export interface ResolveTelemetryLimitsArgs {
  maxHistory?: number
  maxTraceCount?: number
  maxLogCount?: number
  maxMetricCount?: number
  env?: NodeJS.ProcessEnv
}

const defaultLimit = 100

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolveTelemetryLimits(
  args: ResolveTelemetryLimitsArgs = {},
): TelemetryLimits {
  const env = args.env ?? process.env
  const fallback = args.maxHistory ?? defaultLimit

  return {
    maxTraceCount:
      args.maxTraceCount ??
      parseLimit(env.AUTOTEL_MAX_TRACE_COUNT) ??
      fallback,
    maxLogCount:
      args.maxLogCount ??
      parseLimit(env.AUTOTEL_MAX_LOG_COUNT) ??
      fallback,
    maxMetricCount:
      args.maxMetricCount ??
      parseLimit(env.AUTOTEL_MAX_METRIC_COUNT) ??
      fallback,
  }
}

export function appendWithLimit<T>(items: T[], item: T, limit: number): T[] {
  if (limit <= 0) return []
  const next = [...items, item]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export function appendManyWithLimit<T>(
  items: T[],
  incoming: T[],
  limit: number,
): T[] {
  if (limit <= 0 || incoming.length === 0) return limit <= 0 ? [] : items
  const next = [...items, ...incoming]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export function applyTelemetryLimits(
  data: DevtoolsData,
  limits: TelemetryLimits,
): DevtoolsData {
  return {
    ...data,
    traces: data.traces.slice(-limits.maxTraceCount),
    logs: data.logs.slice(-limits.maxLogCount),
    metrics: data.metrics.slice(-limits.maxMetricCount),
  }
}

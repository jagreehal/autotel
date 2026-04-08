// src/server/types.ts
export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER'
  startTime: number
  endTime: number
  duration: number
  attributes: Record<string, any>
  status: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string }
  events?: Array<{ name: string; timestamp: number; attributes?: Record<string, any> }>
}

export interface TraceData {
  traceId: string
  correlationId: string
  rootSpan: SpanData
  spans: SpanData[]
  startTime: number
  endTime: number
  duration: number
  status: 'OK' | 'ERROR' | 'UNSET'
  service: string
}

export interface LogData {
  id: string
  traceId?: string
  spanId?: string
  resourceName?: string
  severityText?: string
  severityNumber?: number
  body: string | Record<string, unknown>
  timestamp: number
  attributes?: Record<string, unknown>
  resource?: Record<string, unknown>
}

export interface MetricData {
  type: 'event' | 'funnel' | 'outcome' | 'value'
  name: string
  value?: number
  attributes: Record<string, any>
  timestamp: number
  traceId?: string
}

export interface ErrorGroup {
  fingerprint: string
  type: string
  message: string
  stackTrace?: string
  count: number
  firstSeen: number
  lastSeen: number
  affectedTraces: string[]
  affectedSpans: string[]
  service?: string
  attributes?: Record<string, unknown>
}

export interface ErrorOccurrence {
  traceId: string
  spanId: string
  spanName: string
  service: string
  timestamp: number
  error: { type: string; message: string; stackTrace?: string }
  attributes?: Record<string, unknown>
}

export interface DevtoolsData {
  traces: TraceData[]
  metrics: MetricData[]
  logs: LogData[]
  errors: ErrorGroup[]
}

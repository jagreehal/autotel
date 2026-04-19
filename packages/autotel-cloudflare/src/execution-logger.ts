import {
  type ExecutionLogger,
  type ExecutionLoggerOptions,
  type ExecutionLogSnapshot,
  getExecutionLogger,
  type TraceContext,
} from 'autotel-edge';

export type {
  ExecutionLogger,
  ExecutionLoggerOptions,
  ExecutionLogSnapshot,
};

export interface WorkersLoggerOptions {
  /** Override derived request id (default: cf-ray header value when present). */
  requestId?: string;
  /** Optional request header allowlist to include in logger context. */
  headers?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectHeaders(
  headers: Headers,
  include: string[] | undefined,
): Record<string, string> | undefined {
  if (!include || include.length === 0) return undefined;

  const allowlist = new Set(include.map((h) => h.toLowerCase()));
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (allowlist.has(key.toLowerCase())) {
      out[key] = value;
    }
  });

  return Object.keys(out).length > 0 ? out : undefined;
}

function pickCfContext(request: Request): Record<string, unknown> {
  const cf = Reflect.get(request, 'cf');
  if (!isRecord(cf)) return {};

  const out: Record<string, unknown> = {};
  if (typeof cf.colo === 'string') out.colo = cf.colo;
  if (typeof cf.country === 'string') out.country = cf.country;
  if (typeof cf.asn === 'number') out.asn = cf.asn;
  if (typeof cf.city === 'string') out.city = cf.city;
  if (typeof cf.region === 'string') out.region = cf.region;
  return out;
}

/**
 * Create an execution logger pre-populated with common request context.
 * Best used from fetch handlers that already run inside autotel span context.
 */
export function createWorkersLogger(
  request: Request,
  options: WorkersLoggerOptions = {},
  ctx?: TraceContext,
): ExecutionLogger {
  const log = getExecutionLogger(ctx);
  const url = new URL(request.url);
  const cfRay = request.headers.get('cf-ray') ?? undefined;
  const traceparent = request.headers.get('traceparent') ?? undefined;

  log.set({
    request: {
      method: request.method,
      path: url.pathname,
      url: request.url,
      requestId: options.requestId ?? cfRay,
      headers: collectHeaders(request.headers, options.headers),
    },
    cfRay,
    traceparent,
    ...pickCfContext(request),
  });

  return log;
}

export function getRequestLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getQueueLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getWorkflowLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

export function getActorLogger(
  ctx?: TraceContext,
  options?: ExecutionLoggerOptions,
): ExecutionLogger {
  return getExecutionLogger(ctx, options);
}

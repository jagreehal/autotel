import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  getRequestLogger,
  getTraceContext,
  otelTrace,
} from 'autotel';
import type { RequestLogger } from 'autotel';

export interface AuditMetadata {
  action: string;
  resource?: string;
  actorId?: string;
  category?: string;
  outcome?: 'success' | 'failure' | (string & {});
  [key: string]: unknown;
}

export interface WithAuditOptions {
  ctx?: AuditContext;
  emitNow?: boolean;
  forceKeep?: boolean;
  logger?: RequestLogger;
}

export interface AuditContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(
    attrs: Record<string, string | number | boolean | string[] | number[] | boolean[]>,
  ): void;
}

function resolveContext(ctx?: AuditContext): AuditContext {
  if (ctx) return ctx;

  const ids = getTraceContext();
  const span = otelTrace.getActiveSpan();
  if (ids && span) {
    return {
      traceId: ids.traceId,
      spanId: ids.spanId,
      correlationId: ids.correlationId,
      setAttribute: (key, value) => span.setAttribute(key, value),
      setAttributes: (attrs) => span.setAttributes(attrs),
    };
  }

  throw new Error(
    '[autotel-audit] No active trace context. Wrap your handler with trace() or pass options.ctx.',
  );
}

function toAttributeValue(
  value: unknown,
): string | number | boolean | string[] | number[] | boolean[] | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) {
      return value;
    }

    if (value.every((entry) => typeof entry === 'number')) {
      return value;
    }

    if (value.every((entry) => typeof entry === 'boolean')) {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '<serialization-failed>';
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '<serialization-failed>';
  }
}

function flattenAuditAttributes(
  metadata: AuditMetadata,
): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
  const attributes: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > = {
    'autotel.audit': true,
  };

  for (const [key, value] of Object.entries(metadata)) {
    const attr = toAttributeValue(value);
    if (attr !== undefined) {
      attributes[`audit.${key}`] = attr;
    }
  }

  return attributes;
}

export function forceKeepAuditEvent(ctx?: AuditContext): void {
  const traceCtx = resolveContext(ctx);
  traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
  traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
  traceCtx.setAttribute('autotel.audit.force_keep', true);
}

export function setAuditAttributes(
  metadata: AuditMetadata,
  ctx?: AuditContext,
): void {
  const traceCtx = resolveContext(ctx);
  traceCtx.setAttributes(flattenAuditAttributes(metadata));
}

export async function withAudit<T>(
  metadata: AuditMetadata,
  fn: (ctx: AuditContext, logger: RequestLogger) => T | Promise<T>,
  options: WithAuditOptions = {},
): Promise<T> {
  const traceCtx = resolveContext(options.ctx);

  if (options.forceKeep !== false) {
    forceKeepAuditEvent(traceCtx);
  }

  setAuditAttributes(metadata, traceCtx);

  const logger = options.logger ?? getRequestLogger();
  logger.set({
    audit: {
      ...metadata,
      forceKeep: options.forceKeep !== false,
    },
  });

  try {
    const result = await fn(traceCtx, logger);

    if (!metadata.outcome) {
      setAuditAttributes({ ...metadata, outcome: 'success' }, traceCtx);
    }

    if (options.emitNow) {
      logger.emitNow();
    }

    return result;
  } catch (error) {
    const asError = error instanceof Error ? error : new Error(String(error));
    setAuditAttributes({ ...metadata, outcome: 'failure' }, traceCtx);
    logger.error(asError, {
      audit: {
        action: metadata.action,
        resource: metadata.resource,
      },
    });

    if (options.emitNow) {
      logger.emitNow();
    }

    throw asError;
  }
}

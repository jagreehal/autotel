import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  createNoopRequestLogger,
  getRequestLoggerSafe,
} from 'autotel';
import type { RequestLogger } from 'autotel';
import {
  MISSING_CONTEXT_MESSAGE,
  noopAuditContext,
  resolveContextSafe,
  toAttributeValue,
  warnMissingContextOnce,
  warnMissingLoggerOnce,
  type AuditContext,
  type OnMissingContext,
} from './context';

export type { AuditContext, OnMissingContext } from './context';
export * from './security';
export * from './security-signals';
export * from './security-heartbeat';

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
  /**
   * Behaviour when no trace context can be resolved. Defaults to `warn`
   * (best-effort: run un-audited, warn once). See {@link OnMissingContext}.
   */
  onMissingContext?: OnMissingContext;
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
  const traceCtx = resolveContextSafe(ctx);
  if (!traceCtx) return;
  traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
  traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
  traceCtx.setAttribute('autotel.audit.force_keep', true);
}

export function setAuditAttributes(
  metadata: AuditMetadata,
  ctx?: AuditContext,
): void {
  const traceCtx = resolveContextSafe(ctx);
  if (!traceCtx) return;
  traceCtx.setAttributes(flattenAuditAttributes(metadata));
}

export async function withAudit<T>(
  metadata: AuditMetadata,
  fn: (ctx: AuditContext, logger: RequestLogger) => T | Promise<T>,
  options: WithAuditOptions = {},
): Promise<T> {
  const traceCtx = resolveContextSafe(options.ctx);

  // No trace context: degrade per onMissingContext instead of throwing into
  // business logic. Audit is observability — it must never crash the caller.
  if (!traceCtx) {
    const mode = options.onMissingContext ?? 'warn';
    if (mode === 'throw') {
      throw new Error(MISSING_CONTEXT_MESSAGE);
    }
    if (mode === 'warn') {
      warnMissingContextOnce(metadata.action);
    }
    return fn(noopAuditContext(), options.logger ?? createNoopRequestLogger());
  }

  if (options.forceKeep !== false) {
    forceKeepAuditEvent(traceCtx);
  }

  setAuditAttributes(metadata, traceCtx);

  // A trace context may exist (e.g. caller-supplied options.ctx) without a
  // resolvable request logger. Record span attributes regardless and only skip
  // the canonical log line — never throw.
  let logger = options.logger ?? getRequestLoggerSafe() ?? undefined;
  if (!logger) {
    if ((options.onMissingContext ?? 'warn') === 'warn') {
      warnMissingLoggerOnce(metadata.action);
    }
    logger = createNoopRequestLogger();
  }
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

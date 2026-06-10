import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  getRequestLogger,
} from 'autotel';
import type { RequestLogger } from 'autotel';
import { resolveContext, toAttributeValue, type AuditContext } from './context';

export type { AuditContext } from './context';
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

import { createHash } from 'node:crypto';
import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  REDACTOR_PATTERNS,
  createNoopRequestLogger,
  getRequestLoggerSafe,
} from 'autotel';
import type { RequestLogger } from 'autotel';
import {
  SECURITY_ATTR,
  SECURITY_METRICS,
  escalateSecuritySeverity,
} from 'autotel/security-schema';
import type { SecuritySeverity } from 'autotel/security-schema';
import {
  MISSING_CONTEXT_MESSAGE,
  noopAuditContext,
  resolveContextSafe,
  toAttributeValue,
  warnMissingContextOnce,
  type AuditContext,
  type OnMissingContext,
} from './context';
import { lazyCounter } from './lazy-counter';

export type { SecuritySeverity };

/**
 * Security event categories, aligned with OWASP A09:2025
 * (Security Logging & Alerting Failures) and ASVS V7.
 */
export type SecurityEventCategory =
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'admin_action'
  | 'configuration'
  | 'secrets'
  | 'rate_limit'
  | 'validation'
  | 'supply_chain'
  | 'llm';

export type SecurityOutcome =
  | 'success'
  | 'failure'
  | 'denied'
  | 'blocked'
  | 'error';

/**
 * Well-known security event names. Free-form names are allowed —
 * this union exists for autocomplete and consistency across services.
 */
export type SuggestedSecurityEventName =
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.mfa.failed'
  | 'auth.session.revoked'
  | 'auth.password.reset'
  | 'auth.account.locked'
  | 'access.denied'
  | 'access.role.changed'
  | 'access.permission.changed'
  | 'access.tenant.violation'
  | 'admin.action'
  | 'config.changed'
  | 'secret.accessed'
  | 'secret.rotation.failed'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'rate_limit.exceeded'
  | 'validation.failed'
  | 'webhook.signature.failed'
  | 'dependency.scan.failed'
  | 'llm.prompt_injection.detected'
  | 'llm.tool_call.denied'
  | 'llm.output.blocked'
  | 'llm.output.budget_exceeded'
  | 'llm.guard.triggered'
  | 'llm.action_chain.suspicious'
  | 'llm.manifest.suspicious'
  | 'llm.plan.risk.elevated';

export interface SecurityEventMetadata {
  /** Stable, dot-separated event name, e.g. `auth.login.failed`. */
  name: SuggestedSecurityEventName | (string & {});
  category: SecurityEventCategory;
  outcome: SecurityOutcome;
  /** Defaults to `info`. */
  severity?: SecuritySeverity;
  /** Stable identifier of the actor — an id or a `hashIdentifier()` digest, never raw PII. */
  actorId?: string;
  targetType?: string;
  targetId?: string;
  tenantId?: string;
  /** Short machine-readable reason, e.g. `invalid_password`. */
  reason?: string;
  [key: string]: unknown;
}

export interface SecurityEventOptions {
  ctx?: AuditContext;
  /**
   * Security events are exempt from tail sampling by default —
   * an attack you sampled away is an attack you cannot investigate.
   * Pass `false` to opt out (e.g. very high-volume info events).
   */
  forceKeep?: boolean;
  emitNow?: boolean;
  logger?: RequestLogger;
  /**
   * Also increment the `autotel.security.events` counter
   * (attributes: event, category, outcome, severity) so security teams
   * can alert on rates without log-based alerting. Default true.
   *
   * Cardinality note: the event name is a counter attribute — keep names
   * to a stable catalogue, never interpolate user input into them.
   */
  metrics?: boolean;
  /**
   * Behaviour when no trace context can be resolved. Defaults to `warn`
   * (best-effort: record nothing, warn once). A dropped security event is still
   * better than a crashed request — but the warning makes the gap visible.
   */
  onMissingContext?: OnMissingContext;
}

export type WithSecurityOptions = SecurityEventOptions;

interface SecurityAttributeSink {
  setAttribute(
    key: string,
    value:
      | string
      | number
      | boolean
      | string[]
      | number[]
      | boolean[],
  ): unknown;
}

/**
 * Standard metadata fields and the schema attribute each maps to.
 * Drives both standard-field emission and the reserved-key check for the
 * custom-attribute loop — adding a field here is the whole change.
 */
const FIELD_ATTRIBUTES: Record<string, string> = {
  name: SECURITY_ATTR.event,
  category: SECURITY_ATTR.category,
  outcome: SECURITY_ATTR.outcome,
  severity: SECURITY_ATTR.severity,
  actorId: SECURITY_ATTR.actorId,
  targetType: SECURITY_ATTR.targetType,
  targetId: SECURITY_ATTR.targetId,
  tenantId: SECURITY_ATTR.tenantId,
  reason: SECURITY_ATTR.reason,
};

function flattenSecurityAttributes(
  metadata: SecurityEventMetadata,
): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
  const attributes: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > = {
    [SECURITY_ATTR.marker]: true,
    [SECURITY_ATTR.severity]: metadata.severity ?? 'info',
  };

  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const standardAttribute = FIELD_ATTRIBUTES[key];
    // Never emit values under credential-shaped custom keys, even by
    // accident. Reuses the core redactor's sensitive-key pattern so the
    // deny-list stays in one place.
    if (
      standardAttribute === undefined &&
      REDACTOR_PATTERNS.sensitiveKey.test(key)
    ) {
      droppedKeys.push(key);
      continue;
    }

    const attr = toAttributeValue(value);
    if (attr !== undefined) {
      attributes[standardAttribute ?? `security.${key}`] = attr;
    }
  }

  if (droppedKeys.length > 0) {
    attributes[SECURITY_ATTR.droppedKeys] = droppedKeys;
  }

  return attributes;
}

const eventsCounter = lazyCounter(
  SECURITY_METRICS.events,
  'Security events by name, category, outcome, and severity',
);

function countSecurityEvent(metadata: SecurityEventMetadata): void {
  eventsCounter.add(1, {
    event: metadata.name,
    category: metadata.category,
    outcome: metadata.outcome,
    severity: metadata.severity ?? 'info',
  });
}

export function applySecurityEventAttributes(
  sink: SecurityAttributeSink,
  metadata: SecurityEventMetadata,
  options: Pick<SecurityEventOptions, 'forceKeep' | 'metrics'> = {},
): void {
  if (options.metrics !== false) {
    countSecurityEvent(metadata);
  }

  if (options.forceKeep !== false) {
    sink.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
    sink.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
    sink.setAttribute(SECURITY_ATTR.forceKeep, true);
  }

  for (const [key, value] of Object.entries(flattenSecurityAttributes(metadata))) {
    sink.setAttribute(key, value);
  }
}

/**
 * Record a security event on the active trace and request logger.
 *
 * Events are force-kept through tail sampling by default and carry
 * `security.*` attributes (`security.event`, `security.category`,
 * `security.outcome`, `security.severity`) so backends can build
 * detection rules and dashboards from a stable schema.
 *
 * ```typescript
 * securityEvent({
 *   name: 'auth.login.failed',
 *   category: 'authentication',
 *   outcome: 'failure',
 *   severity: 'warning',
 *   actorId: hashIdentifier(email),
 *   reason: 'invalid_password',
 * });
 * ```
 */
export function securityEvent(
  metadata: SecurityEventMetadata,
  options: SecurityEventOptions = {},
): void {
  const traceCtx = resolveContextSafe(options.ctx);

  // Counters are independent of trace context — always record the security signal
  // even when there's no span to attach attributes to.
  if (options.metrics !== false) {
    countSecurityEvent(metadata);
  }

  if (!traceCtx) {
    const mode = options.onMissingContext ?? 'warn';
    if (mode === 'throw') {
      throw new Error(MISSING_CONTEXT_MESSAGE);
    }
    if (mode === 'warn') {
      warnMissingContextOnce(metadata.name);
    }
    return;
  }

  if (options.forceKeep !== false) {
    traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
    traceCtx.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
    traceCtx.setAttribute(SECURITY_ATTR.forceKeep, true);
  }
  traceCtx.setAttributes(flattenSecurityAttributes(metadata));

  const logger = options.logger ?? getRequestLoggerSafe() ?? createNoopRequestLogger();
  logger.set({
    security: {
      name: metadata.name,
      category: metadata.category,
      outcome: metadata.outcome,
      severity: metadata.severity ?? 'info',
      ...(metadata.reason !== undefined && { reason: metadata.reason }),
      forceKeep: options.forceKeep !== false,
    },
  });

  if (options.emitNow) {
    logger.emitNow();
  }
}

/**
 * Wrap a security-sensitive operation. On success the event outcome is
 * recorded as given (default `success`); a thrown error records
 * `outcome: 'error'`, escalates the severity to at least `error`, and
 * rethrows.
 *
 * ```typescript
 * await withSecurity(
 *   { name: 'api_key.created', category: 'secrets', outcome: 'success', actorId: userId },
 *   async () => createApiKey(userId),
 * );
 * ```
 */
export async function withSecurity<T>(
  metadata: SecurityEventMetadata,
  fn: (ctx: AuditContext, logger: RequestLogger) => T | Promise<T>,
  options: WithSecurityOptions = {},
): Promise<T> {
  const traceCtx = resolveContextSafe(options.ctx);
  const logger =
    options.logger ?? getRequestLoggerSafe() ?? createNoopRequestLogger();
  const ctx = traceCtx ?? noopAuditContext();

  try {
    const result = await fn(ctx, logger);
    securityEvent(metadata, { ...options, ctx: traceCtx ?? undefined, logger });
    return result;
  } catch (error) {
    const asError = error instanceof Error ? error : new Error(String(error));
    securityEvent(
      {
        ...metadata,
        outcome: 'error',
        // A failed security-sensitive operation is never less than an error,
        // but an explicit `critical` stays critical.
        severity: escalateSecuritySeverity(metadata.severity ?? 'info', 'error'),
      },
      { ...options, ctx: traceCtx ?? undefined, logger },
    );
    logger.error(asError, {
      security: {
        name: metadata.name,
        category: metadata.category,
      },
    });
    throw asError;
  }
}

export interface HashIdentifierOptions {
  /** Optional salt; use one stable per-deployment salt to defeat rainbow lookups. */
  salt?: string;
  /** Digest length in hex chars (default 16). */
  length?: number;
}

/**
 * Stable one-way digest for correlating PII-bearing identifiers
 * (emails, IPs) across events WITHOUT logging the raw value.
 *
 * NOT for secrets — never log secrets in any form, hashed or not.
 */
export function hashIdentifier(
  value: string,
  options: HashIdentifierOptions = {},
): string {
  const length = options.length ?? 16;
  return createHash('sha256')
    .update(options.salt ? `${options.salt}:${value}` : value)
    .digest('hex')
    .slice(0, length);
}

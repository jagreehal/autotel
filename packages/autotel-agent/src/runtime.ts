import { getRequestLogger, type RequestLogger } from 'autotel';
import { forceKeepAuditEvent, withAudit } from 'autotel-audit';
import { setAgentAttributes, setAgentOutcome } from './attributes.js';
import {
  buildLoggerContext,
  buildLifecycleUpdateContext,
  buildAuditMetadata,
  normalizeMetadata,
} from './metadata.js';
import { resolveContext, type AgentContext } from './context.js';
import { hashPayload } from './hash.js';
import type {
  AgentActionFactory,
  AgentActionMetadata,
  AgentActionOptions,
  AgentHandler,
  AgentMetadataInput,
  AgentToolCallActionMetadata,
  AgentToolCallOptions,
  ToolCallMetadata,
} from './types.js';

export async function withAgentAction<T>(
  metadata: AgentActionMetadata,
  fn: AgentHandler<T>,
  options: AgentActionOptions = {},
): Promise<T> {
  const normalized = normalizeMetadata(metadata);

  return withAudit(
    buildAuditMetadata(normalized),
    async (ctx: AgentContext, logger: RequestLogger) => {
      setAgentAttributes(normalized, ctx);
      logger.set(buildLoggerContext(normalized));

      try {
        const result = await fn(ctx as AgentContext, logger);
        const outcome = normalized.outcome ?? 'success';
        setAgentOutcome(outcome, ctx);
        logger.set({ agent: { outcome } });
        return result;
      } catch (error) {
        setAgentOutcome('failure', ctx);
        logger.set({ agent: { outcome: 'failure' } });
        throw error;
      }
    },
    options,
  );
}

export function recordPolicyDecision(
  metadata: AgentActionMetadata,
  options: AgentActionOptions = {},
): void {
  const normalized = normalizeMetadata(metadata);
  const traceCtx = resolveContext(options.ctx);
  const logger = options.logger ?? getRequestLogger();

  if (options.forceKeep !== false) {
    forceKeepAuditEvent(traceCtx);
  }

  setAgentAttributes(normalized, traceCtx);
  logger.set(buildLoggerContext(normalized));

  if (options.emitNow) {
    logger.emitNow();
  }
}

export function recordDecisionBasis(
  metadata: AgentActionMetadata,
  options: AgentActionOptions = {},
): void {
  if (!metadata.decision && !metadata.reasoningSummary) {
    throw new Error(
      '[autotel-agent] recordDecisionBasis requires metadata.decision or metadata.reasoningSummary.',
    );
  }

  recordPolicyDecision(metadata, options);
}

/**
 * Define a reusable, instrumented agent action — the `trace()`-style factory
 * companion to `withAgentAction`. Declare it once at module scope and call the
 * returned function many times; each call opens its own audit scope.
 *
 * `metadata` may be a static object or a function of the call arguments, so
 * call-specific fields can be derived per invocation.
 *
 * @example
 * ```ts
 * const planTrip = defineAgentAction(
 *   (req: TripRequest) => ({
 *     action: 'agent.trip.plan',
 *     agent: { id: 'planner' },
 *     delegation: { parentIdentity: req.userId, scope: ['trip:plan'] },
 *   }),
 *   (ctx) => async (req: TripRequest) => planItinerary(req),
 * );
 *
 * await planTrip({ userId: 'usr_1', destination: 'Lisbon' });
 * ```
 */
export function defineAgentAction<TArgs extends unknown[], TResult>(
  metadata: AgentMetadataInput<TArgs, AgentActionMetadata>,
  factory: AgentActionFactory<TArgs, TResult>,
  options: AgentActionOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs): Promise<TResult> => {
    const resolved =
      typeof metadata === 'function' ? metadata(...args) : metadata;
    return withAgentAction(
      resolved,
      (ctx, logger) => factory(ctx, logger)(...args),
      options,
    );
  };
}

/**
 * Define a reusable, instrumented agent tool call — the `trace()`-style factory
 * companion to `withAgentToolCall`. Declare it once and call it per invocation;
 * tool inputs/results are hashed (never attached raw) on every call.
 *
 * Pass `metadata` as a function of the arguments when `tool.input` (or any other
 * field) depends on the call, so each invocation hashes its own input.
 *
 * @example
 * ```ts
 * const handleRefund = defineAgentToolCall(
 *   (req: RefundRequest) => ({
 *     action: 'agent.refund.tool_call',
 *     resource: 'stripe_refund_v3',
 *     agent: { id: 'refunds-specialist' },
 *     tool: { name: 'stripe_refund_v3', input: { refundId: req.refundId } },
 *   }),
 *   (ctx) => async (req: RefundRequest) => stripe.refunds.create(req),
 * );
 *
 * await handleRefund({ refundId: 're_123' });
 * ```
 */
export function defineAgentToolCall<TArgs extends unknown[], TResult>(
  metadata: AgentMetadataInput<TArgs, AgentToolCallActionMetadata>,
  factory: AgentActionFactory<TArgs, TResult>,
  options: AgentToolCallOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs): Promise<TResult> => {
    const resolved =
      typeof metadata === 'function' ? metadata(...args) : metadata;
    return withAgentToolCall(
      resolved,
      (ctx, logger) => factory(ctx, logger)(...args),
      options,
    );
  };
}

export async function withAgentToolCall<T>(
  metadata: AgentActionMetadata & { tool: ToolCallMetadata },
  fn: AgentHandler<T>,
  options: AgentToolCallOptions = {},
): Promise<T> {
  const start = Date.now();
  const normalized = normalizeMetadata({
    ...metadata,
    tool: {
      ...metadata.tool,
      status: metadata.tool?.status ?? 'planned',
    } as ToolCallMetadata,
  });

  return withAgentAction(
    normalized,
    async (ctx, logger) => {
      try {
        const result = await fn(ctx, logger);
        const executionMs = Date.now() - start;
        const completed: AgentActionMetadata = {
          ...normalized,
          outcome: normalized.outcome ?? 'success',
          tool: {
            ...metadata.tool,
            inputHash: normalized.tool?.inputHash,
            outputHash:
              normalized.tool?.outputHash ??
              (options.hashResult === false ? undefined : hashPayload(result)),
            status: 'complete',
            executionMs,
          },
        };
        setAgentAttributes(completed, ctx);
        logger.set(buildLifecycleUpdateContext(normalizeMetadata(completed)));
        return result;
      } catch (error) {
        const failed: AgentActionMetadata = {
          ...normalized,
          outcome: 'failure',
          tool: {
            ...metadata.tool,
            inputHash: normalized.tool?.inputHash,
            status: 'error',
            executionMs: Date.now() - start,
          },
        };
        setAgentAttributes(failed, ctx);
        logger.set(buildLifecycleUpdateContext(normalizeMetadata(failed)));
        throw error;
      }
    },
    options,
  );
}

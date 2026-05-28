import { span as autotelSpan, getActiveSpan } from 'autotel';
import { buildPactAttributes, outcomeAttribute } from './attrs.js';
import { appendLedgerEntry, type LedgerOptions } from './ledger.js';
import {
  LEDGER_ENTRY_SPEC,
  type InteractionLedgerEntry,
  type PactInteractionMeta,
  type PactKind,
} from './types.js';

/**
 * Minimal structural type for `MessageConsumerPact`. We don't declare
 * `config` here because pact-js marks it `private` — listing it on a
 * public structural type would prevent users passing the real class.
 * Inside the wrapper we read `(pact as MessageConsumerPactWithConfig).config`
 * at runtime, with `opts.consumer` / `opts.provider` as override fallbacks.
 */
export interface MessageConsumerPactLike {
  verify: (handler: (message: ReifiedMessage) => Promise<unknown>) => Promise<unknown>;
  /**
   * Optional fluent metadata appender. Pact-JS's `MessageConsumerPact`
   * provides this; we use it (when present) to write `interactionId`
   * into the pact file's `messages[].metadata` block so the audit can
   * key on the same id from both sides.
   *
   * The value type is `string` because that is the only thing autotel-pact
   * passes. A narrower-than-pact-js type keeps real `MessageConsumerPact`
   * assignable here by parameter contravariance.
   */
  withMetadata?: (metadata: Record<string, string>) => MessageConsumerPactLike;
}

interface MessageConsumerPactWithConfig extends MessageConsumerPactLike {
  config?: { consumer?: string; provider?: string };
}

export interface ReifiedMessage {
  contents: unknown;
  description?: string;
  metadata?: Record<string, unknown>;
  providerStates?: Array<{ name: string }>;
}

export type PactMessageHandler<R = unknown> = (
  message: ReifiedMessage,
) => R | Promise<R>;

export interface WithPactInteractionOptions extends LedgerOptions {
  /**
   * Path (relative to cwd) of the pact file this interaction belongs to.
   * Stamped on the span as `pact.contract.file` and surfaced in the audit.
   */
  contractFile?: string;
  /**
   * Override the span name. Defaults to `pact.interaction`.
   */
  spanName?: string;
  /**
   * Consumer name. Only needed if the supplied pact instance doesn't expose
   * `.config.consumer` (e.g. a custom pact-like wrapper).
   */
  consumer?: string;
  /**
   * Provider name. Same caveat as `consumer`.
   */
  provider?: string;
  /**
   * Stable identity for this interaction. Recommended whenever you might
   * rename the human-readable `expectsToReceive` description in the future —
   * the audit matches on `interactionId` first, so renames don't break
   * continuity. Conventional form: `domain.event.vN` (e.g. `order.created.v1`).
   */
  interactionId?: string;
}

function resolveParticipants(
  pact: MessageConsumerPactLike,
  opts: WithPactInteractionOptions,
): { consumer: string; provider: string } {
  const cfg = (pact as MessageConsumerPactWithConfig).config;
  const consumer = opts.consumer ?? cfg?.consumer;
  const provider = opts.provider ?? cfg?.provider;
  if (!consumer || !provider) {
    throw new Error(
      'autotel-pact: could not resolve consumer/provider from the Pact instance. ' +
        'Pass `{ consumer, provider }` in the options object.',
    );
  }
  return { consumer, provider };
}

/**
 * Wrap a Pact-Message `verify()` call so that:
 *   1. An autotel span opens around the verification.
 *   2. Span attributes capture consumer / provider / interaction / states.
 *   3. A ledger entry records that this interaction was actually exercised.
 *
 * The handler arg to `verify()` is wrapped so we can read the reified
 * message (the only place description + states are exposed by Pact-JS).
 *
 * @example
 * ```ts
 * const pact = new MessageConsumerPact({ consumer, provider, dir });
 * pact.given('an order exists').expectsToReceive('OrderCreated').withContent({...});
 *
 * await withPactInteraction(pact, (msg) => orderHandler(msg.contents));
 * ```
 */
export async function withPactInteraction<R>(
  pact: MessageConsumerPactLike,
  handler: PactMessageHandler<R>,
  opts: WithPactInteractionOptions = {},
): Promise<R> {
  const start = process.hrtime.bigint();
  const spanName = opts.spanName ?? 'pact.interaction';
  const kind: PactKind = 'message';
  const { consumer, provider } = resolveParticipants(pact, opts);

  // When the caller asked for a stable interaction id, write it into the
  // pact file's message metadata so the audit matches the same identity
  // on both sides. Without this, the ledger entry carries the id but the
  // pact file does not — producing one STALE row (description-keyed
  // contracted) and one SHADOW row (id-keyed observed) for what is really
  // a single interaction.
  if (opts.interactionId && typeof pact.withMetadata === 'function') {
    pact.withMetadata({ interactionId: opts.interactionId });
  }

  let captured: ReifiedMessage | undefined;
  let handlerResult: R | undefined;

  // Run the verify inside an autotel span. We populate attributes once we
  // have the reified message; until then `pact.consumer` / `pact.provider`
  // are known but the description/states are not.
  return autotelSpan(spanName, async (span) => {
    span.setAttributes({
      'pact.consumer': consumer,
      'pact.provider': provider,
      'pact.kind': kind,
    });

    try {
      await pact.verify(async (reified) => {
        captured = reified;
        const meta: PactInteractionMeta = {
          consumer,
          provider,
          description: reified.description ?? '<unknown>',
          states: (reified.providerStates ?? []).map((s) => s.name),
          kind,
          interactionId: opts.interactionId,
        };
        span.setAttributes(buildPactAttributes(meta, { contractFile: opts.contractFile }));

        handlerResult = (await handler(reified)) as R;
        return handlerResult;
      });

      span.setAttributes(outcomeAttribute('passed'));
      writeLedgerForOutcome({
        consumer,
        provider,
        captured,
        kind,
        outcome: 'passed',
        start,
        opts,
      });

      return handlerResult as R;
    } catch (error) {
      span.setAttributes(outcomeAttribute('failed'));
      writeLedgerForOutcome({
        consumer,
        provider,
        captured,
        kind,
        outcome: 'failed',
        start,
        opts,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}

function writeLedgerForOutcome(args: {
  consumer: string;
  provider: string;
  captured: ReifiedMessage | undefined;
  kind: PactKind;
  outcome: 'passed' | 'failed';
  start: bigint;
  opts: WithPactInteractionOptions;
  error?: string;
}): void {
  const { consumer, provider, captured, kind, outcome, start, opts, error } = args;
  const ctx = getActiveSpan()?.spanContext();
  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer,
    provider,
    interaction: captured?.description ?? '<unknown>',
    interaction_id: opts.interactionId,
    states: (captured?.providerStates ?? []).map((s) => s.name),
    kind,
    source: 'test',
    role: 'consumer',
    outcome,
    duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
    observed_at: new Date().toISOString(),
    trace_id: ctx?.traceId,
    span_id: ctx?.spanId,
    run_id: process.env.AUTOTEL_PACT_RUN_ID,
    git_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA,
    error,
  };
  appendLedgerEntry(entry, opts);
}

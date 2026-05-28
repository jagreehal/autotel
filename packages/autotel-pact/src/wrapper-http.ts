// HTTP Pact wrapper. Mirrors the Pact-Message wrapper shape but targets
// PactV3 / PactV4 (HTTP) instances, where the lifecycle is
// `addInteraction(...)` + `executeTest(fn)` instead of `.verify(handler)`.

import { span as autotelSpan, getActiveSpan } from 'autotel';
import { buildPactAttributes, outcomeAttribute } from './attrs.js';
import { appendLedgerEntry, type LedgerOptions } from './ledger.js';
import {
  LEDGER_ENTRY_SPEC,
  type InteractionLedgerEntry,
  type PactInteractionMeta,
} from './types.js';

/**
 * Minimal structural type for a PactV3 / PactV4 HTTP pact instance — we
 * only call `addInteraction` and `executeTest`. The `opts` property is
 * private in Pact-JS but readable at runtime, exactly like the message
 * variant's `config`.
 */
export interface HttpPactLike {
  addInteraction: (interaction: HttpInteraction) => unknown;
  executeTest: <T>(testFn: (mockServer: HttpMockServer) => Promise<T>) => Promise<T | undefined>;
}

interface HttpPactWithOpts extends HttpPactLike {
  opts?: { consumer?: string; provider?: string };
}

/**
 * Structural shape of a single HTTP interaction as passed to
 * `PactV3.addInteraction`. We only read the description and states
 * directly; the rest is forwarded to Pact untouched.
 */
export interface HttpInteraction {
  uponReceiving: string;
  states?: Array<{ description: string; parameters?: unknown }>;
  withRequest?: unknown;
  willRespondWith?: unknown;
  [key: string]: unknown;
}

/** Subset of Pact's `V3MockServer` the test function typically uses. */
export interface HttpMockServer {
  url: string;
  port: number;
  [key: string]: unknown;
}

export type HttpPactTestFn<T> = (mockServer: HttpMockServer) => Promise<T>;

export interface WithHttpPactInteractionOptions extends LedgerOptions {
  contractFile?: string;
  spanName?: string;
  consumer?: string;
  provider?: string;
  /** See {@link WithPactInteractionOptions.interactionId}. */
  interactionId?: string;
}

function resolveHttpParticipants(
  pact: HttpPactLike,
  opts: WithHttpPactInteractionOptions,
): { consumer: string; provider: string } {
  const fromOpts = (pact as HttpPactWithOpts).opts;
  const consumer = opts.consumer ?? fromOpts?.consumer;
  const provider = opts.provider ?? fromOpts?.provider;
  if (!consumer || !provider) {
    throw new Error(
      'autotel-pact: could not resolve consumer/provider from the PactV3 instance. ' +
        'Pass `{ consumer, provider }` in the options object.',
    );
  }
  return { consumer, provider };
}

/**
 * Wrap a Pact-JS HTTP test (PactV3 / PactV4) so that:
 *   1. The interaction is added to the pact via `addInteraction`.
 *   2. An autotel span opens around the test body, with `pact.*` attributes.
 *   3. A ledger entry records that this interaction was exercised.
 *
 * Mirrors `withPactInteraction` (the message variant) so the DX is the
 * same regardless of contract kind.
 *
 * @example
 * ```ts
 * const provider = new PactV3({ consumer: 'Web', provider: 'Catalog', dir: './pacts' });
 *
 * it('gets all products', async () => {
 *   await withHttpPactInteraction(
 *     provider,
 *     {
 *       states: [{ description: 'products exist' }],
 *       uponReceiving: 'get all products',
 *       withRequest: { method: 'GET', path: '/products' },
 *       willRespondWith: { status: 200, body: [...] },
 *     },
 *     async (mockServer) => {
 *       const api = new API(mockServer.url);
 *       expect(await api.getAllProducts()).toEqual([...]);
 *     },
 *   );
 * });
 * ```
 */
export async function withHttpPactInteraction<T>(
  pact: HttpPactLike,
  interaction: HttpInteraction,
  testFn: HttpPactTestFn<T>,
  opts: WithHttpPactInteractionOptions = {},
): Promise<T | undefined> {
  // PactV3 interactions have no metadata channel we can write an id into
  // (V4's `comments` field will let us do this in a future release). Without
  // a way to land the id on the pact-file side, observed-side and contracted-
  // side would key on different identities and produce spurious STALE+SHADOW
  // pairs. Refuse the option until v0.2 wires it through PactV4.
  if (opts.interactionId !== undefined) {
    throw new Error(
      'autotel-pact: `interactionId` is not yet supported for HTTP Pact. ' +
        'PactV3 interactions have no metadata channel to persist the id; ' +
        'support arrives in v0.2 via PactV4 comments. Use the description as ' +
        'the stable identity for HTTP interactions in v0.1.',
    );
  }

  const start = process.hrtime.bigint();
  const spanName = opts.spanName ?? 'pact.interaction';
  const kind = 'http' as const;
  const { consumer, provider } = resolveHttpParticipants(pact, opts);

  const meta: PactInteractionMeta = {
    consumer,
    provider,
    description: interaction.uponReceiving,
    states: (interaction.states ?? []).map((s) => s.description),
    kind,
    interactionId: opts.interactionId,
  };

  pact.addInteraction(interaction);

  return autotelSpan(spanName, async (span) => {
    span.setAttributes(buildPactAttributes(meta, { contractFile: opts.contractFile }));

    try {
      const result = await pact.executeTest(testFn);
      span.setAttributes(outcomeAttribute('passed'));
      writeHttpLedgerEntry({ meta, outcome: 'passed', start, opts });
      return result;
    } catch (error) {
      span.setAttributes(outcomeAttribute('failed'));
      writeHttpLedgerEntry({
        meta,
        outcome: 'failed',
        start,
        opts,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}

function writeHttpLedgerEntry(args: {
  meta: PactInteractionMeta;
  outcome: 'passed' | 'failed';
  start: bigint;
  opts: WithHttpPactInteractionOptions;
  error?: string;
}): void {
  const { meta, outcome, start, opts, error } = args;
  const ctx = getActiveSpan()?.spanContext();
  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer: meta.consumer,
    provider: meta.provider,
    interaction: meta.description,
    interaction_id: meta.interactionId,
    states: meta.states,
    kind: 'http',
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

import path from 'node:path';
import { span as autotelSpan, getActiveSpan } from 'autotel';
import { appendLedgerEntry, appendProviderVerificationFailure, type LedgerOptions } from './ledger.js';
import { interactionsFromPactFile, parsePactFile } from './pact-file.js';
import { LEDGER_ENTRY_SPEC, type InteractionLedgerEntry, type PactKind } from './types.js';
import { PACT_ATTRS } from './attrs.js';

/**
 * Minimal Verifier options — structural match for @pact-foundation/pact Verifier.
 */
export interface VerifierOptionsLike {
  provider: string;
  providerBaseUrl: string;
  pactUrls?: string[];
  logLevel?: string;
  [key: string]: unknown;
}

export interface VerifierLike {
  verifyProvider: () => Promise<unknown>;
}

export interface VerifierConstructor {
  new (options: VerifierOptionsLike): VerifierLike;
}

export interface WithProviderVerificationOptions extends LedgerOptions {
  /** Consumer name when not inferrable from pact files. */
  consumer?: string;
  spanName?: string;
  /** Custom Verifier class (defaults to dynamic import from @pact-foundation/pact). */
  Verifier?: VerifierConstructor;
  /**
   * Skip loading and calling the Verifier entirely. Emits the same
   * per-interaction ledger rows as a successful verification, parsed from the
   * supplied pact files. Use for demos, smoke tests, and audit-pipeline
   * exercises where running a real provider is impractical. Do not use in
   * production CI: it will mark every interaction in the pact file as
   * provider-verified without any actual verification.
   */
  skipVerifier?: boolean;
}

function resolvePactPaths(opts: VerifierOptionsLike): string[] {
  const urls = opts.pactUrls ?? [];
  return urls.map((u) => path.resolve(process.cwd(), u));
}

function inferConsumerFromPacts(pactPaths: string[], fallback?: string): string {
  for (const filePath of pactPaths) {
    const pact = parsePactFile(filePath);
    if (pact?.consumer?.name) return pact.consumer.name;
  }
  if (fallback) return fallback;
  throw new Error(
    'autotel-pact: could not infer consumer from pact files. Pass `consumer` in options.',
  );
}

function kindForPactFile(filePath: string): PactKind {
  const pact = parsePactFile(filePath);
  if (!pact) return 'message';
  if ((pact.interactions?.length ?? 0) > 0) return 'http';
  return 'message';
}

async function loadVerifier(
  VerifierClass?: VerifierConstructor,
): Promise<VerifierConstructor> {
  if (VerifierClass) return VerifierClass;
  const mod = await import('@pact-foundation/pact');
  const Verifier = (mod as { Verifier?: VerifierConstructor }).Verifier;
  if (!Verifier) {
    throw new Error(
      'autotel-pact: @pact-foundation/pact Verifier not found. Install the peer dependency.',
    );
  }
  return Verifier;
}

/**
 * Wrap provider verification — records per-interaction evidence only on success.
 */
export async function withProviderVerification(
  verifierOpts: VerifierOptionsLike,
  wrapOpts: WithProviderVerificationOptions = {},
): Promise<void> {
  const pactPaths = resolvePactPaths(verifierOpts);
  const provider = verifierOpts.provider;
  const consumer = inferConsumerFromPacts(pactPaths, wrapOpts.consumer);
  const spanName = wrapOpts.spanName ?? 'pact.verification';
  const start = process.hrtime.bigint();
  const Verifier = wrapOpts.skipVerifier ? undefined : await loadVerifier(wrapOpts.Verifier);

  return autotelSpan(spanName, async () => {
    const span = getActiveSpan();
    span?.setAttributes({
      [PACT_ATTRS.CONSUMER]: consumer,
      [PACT_ATTRS.PROVIDER]: provider,
      [PACT_ATTRS.KIND]: pactPaths.length === 1 ? kindForPactFile(pactPaths[0]!) : 'message',
      'pact.role': 'provider',
    });

    try {
      if (Verifier) {
        await new Verifier(verifierOpts).verifyProvider();
      }
      span?.setAttributes({ [PACT_ATTRS.OUTCOME]: 'passed' });

      const ctx = span?.spanContext();
      const base = {
        source: 'test' as const,
        role: 'provider' as const,
        outcome: 'passed' as const,
        observed_at: new Date().toISOString(),
        trace_id: ctx?.traceId,
        span_id: ctx?.spanId,
        run_id: process.env.AUTOTEL_PACT_RUN_ID,
        git_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA,
      };

      for (const filePath of pactPaths) {
        const pact = parsePactFile(filePath);
        if (!pact) continue;
        const interactions = interactionsFromPactFile(pact);
        for (const i of interactions) {
          const entry: InteractionLedgerEntry = {
            type: 'interaction',
            spec: LEDGER_ENTRY_SPEC,
            consumer: i.consumer,
            provider: i.provider,
            interaction: i.interaction,
            interaction_id: i.interactionId,
            states: [],
            kind: i.kind,
            duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
            ...base,
          };
          appendLedgerEntry(entry, wrapOpts);
        }
      }
    } catch (error) {
      span?.setAttributes({ [PACT_ATTRS.OUTCOME]: 'failed' });
      const message = error instanceof Error ? error.message : String(error);
      const ctx = span?.spanContext();
      appendProviderVerificationFailure(
        {
          consumer,
          provider,
          source: 'test',
          observed_at: new Date().toISOString(),
          error: message,
          trace_id: ctx?.traceId,
          span_id: ctx?.spanId,
          run_id: process.env.AUTOTEL_PACT_RUN_ID,
          git_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA,
        },
        wrapOpts,
      );
      throw error;
    }
  });
}

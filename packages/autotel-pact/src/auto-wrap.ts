/**
 * Auto-wrap entry for vitest / jest setup files.
 *
 * Importing this module monkey-patches `@pact-foundation/pact`'s
 * `MessageConsumerPact.prototype.verify` and `PactV3.prototype.executeTest`
 * so every contract test in the project records a ledger entry without
 * users having to wrap each call by hand.
 *
 * Usage (vitest):
 *
 * ```ts
 * // vitest.config.ts
 * import { defineConfig } from 'vitest/config';
 * export default defineConfig({
 *   test: { setupFiles: ['autotel-pact/auto-wrap'] },
 * });
 * ```
 *
 * Usage (jest):
 *
 * ```js
 * // jest.config.js
 * module.exports = { setupFilesAfterEach: ['autotel-pact/auto-wrap'] };
 * ```
 *
 * Configuration is via environment variables — there's no API surface,
 * because setup files don't get parameters:
 *
 * - `AUTOTEL_PACT_RUN_ID` — tag every ledger entry with this run id
 * - `AUTOTEL_PACT_LEDGER_DIR` — override the default `.autotel-pact/` dir
 *
 * Idempotent: importing twice is a no-op.
 *
 * Safe when Pact-JS isn't installed: logs a single warning and exits
 * cleanly. The same setup file can stay in place for a repo whose
 * non-contract test packages don't have Pact as a dependency.
 */

import { span as autotelSpan, getActiveSpan } from 'autotel';
import { createRequire } from 'node:module';
import { buildPactAttributes, outcomeAttribute } from './attrs.js';
import { appendLedgerEntry } from './ledger.js';
import { LEDGER_ENTRY_SPEC, type InteractionLedgerEntry, type PactInteractionMeta } from './types.js';
import type { HttpInteraction } from './wrapper-http.js';
import type { ReifiedMessage } from './wrapper.js';

const INSTALLED = Symbol.for('autotel-pact:auto-wrap-installed');

interface PactJsModule {
  MessageConsumerPact?: { prototype: Record<string | symbol, unknown> };
  PactV3?: { prototype: Record<string | symbol, unknown> };
}

/**
 * Install the auto-wrap. Called at module load when this file is imported.
 * Exposed for tests + explicit-invocation users.
 *
 * @param pactModule Override Pact-JS resolution. When omitted, requires
 *   `@pact-foundation/pact` from disk. Tests can pass synthetic classes.
 *
 * Returns `true` if Pact-JS was found and patched, `false` otherwise.
 */
export function installAutoWrap(pactModule?: PactJsModule): boolean {
  const pactJs = pactModule ?? loadPactJs();
  if (!pactJs) return false;

  patchMessagePact(pactJs);
  patchHttpPact(pactJs);
  return true;
}

function loadPactJs(): PactJsModule | undefined {
  try {
    // Use createRequire so we work from both ESM and CJS without
    // pulling Pact-JS into the dynamic import graph.
    const require = createRequire(import.meta.url);
    return require('@pact-foundation/pact') as PactJsModule;
  } catch {
    process.stderr.write(
      'autotel-pact/auto-wrap: @pact-foundation/pact not installed — skipping.\n',
    );
    return undefined;
  }
}

function patchMessagePact(mod: PactJsModule): void {
  const ctor = mod.MessageConsumerPact;
  if (!ctor) return;
  const proto = ctor.prototype;
  if (proto[INSTALLED]) return;

  const originalVerify = proto.verify as (
    handler: (m: ReifiedMessage) => Promise<unknown>,
  ) => Promise<unknown>;

  proto.verify = async function patchedVerify(
    this: { config: { consumer: string; provider: string } },
    handler: (m: ReifiedMessage) => Promise<unknown>,
  ): Promise<unknown> {
    const start = process.hrtime.bigint();
    let captured: ReifiedMessage | undefined;
    const consumer = this.config?.consumer ?? '<unknown>';
    const provider = this.config?.provider ?? '<unknown>';

    return autotelSpan('pact.interaction', async (span) => {
      span.setAttributes({
        'pact.consumer': consumer,
        'pact.provider': provider,
        'pact.kind': 'message',
      });

      try {
        const result = await originalVerify.call(this, async (reified) => {
          captured = reified;
          const meta: PactInteractionMeta = {
            consumer,
            provider,
            description: reified.description ?? '<unknown>',
            states: (reified.providerStates ?? []).map((s) => s.name),
            kind: 'message',
          };
          span.setAttributes(buildPactAttributes(meta));
          return handler(reified);
        });
        span.setAttributes(outcomeAttribute('passed'));
        writeAutoLedgerEntry({
          consumer,
          provider,
          interaction: captured?.description ?? '<unknown>',
          states: (captured?.providerStates ?? []).map((s) => s.name),
          kind: 'message',
          outcome: 'passed',
          start,
        });
        return result;
      } catch (error) {
        span.setAttributes(outcomeAttribute('failed'));
        writeAutoLedgerEntry({
          consumer,
          provider,
          interaction: captured?.description ?? '<unknown>',
          states: (captured?.providerStates ?? []).map((s) => s.name),
          kind: 'message',
          outcome: 'failed',
          start,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  };

  proto[INSTALLED] = true;
}

function patchHttpPact(mod: PactJsModule): void {
  const ctor = mod.PactV3;
  if (!ctor) return;
  const proto = ctor.prototype;
  if (proto[INSTALLED]) return;

  // Track interactions added to each PactV3 instance. Cleared after
  // executeTest emits ledger entries for them, so the same instance can
  // be reused across multiple test cases.
  const tracked = new WeakMap<object, HttpInteraction[]>();

  const originalAdd = proto.addInteraction as (i: HttpInteraction) => unknown;
  proto.addInteraction = function patchedAddInteraction(this: object, interaction: HttpInteraction) {
    const list = tracked.get(this) ?? [];
    list.push(interaction);
    tracked.set(this, list);
    return originalAdd.call(this, interaction);
  };

  const originalExecute = proto.executeTest as <T>(
    fn: (server: { url: string; port: number }) => Promise<T>,
  ) => Promise<T | undefined>;

  proto.executeTest = async function patchedExecuteTest<T>(
    this: { opts?: { consumer?: string; provider?: string } },
    fn: (server: { url: string; port: number }) => Promise<T>,
  ): Promise<T | undefined> {
    const start = process.hrtime.bigint();
    const consumer = this.opts?.consumer ?? '<unknown>';
    const provider = this.opts?.provider ?? '<unknown>';
    const interactions = tracked.get(this) ?? [];
    tracked.set(this, []);

    return autotelSpan('pact.interaction', async (span) => {
      span.setAttributes({
        'pact.consumer': consumer,
        'pact.provider': provider,
        'pact.kind': 'http',
      });
      // If multiple interactions were added before executeTest, the span
      // attributes describe the first; ledger entries are still written
      // for each. Most real tests use one interaction per executeTest.
      const first = interactions[0];
      if (first) {
        span.setAttributes(
          buildPactAttributes({
            consumer,
            provider,
            description: first.uponReceiving,
            states: (first.states ?? []).map((s) => s.description),
            kind: 'http',
          }),
        );
      }

      try {
        const result = (await originalExecute.call(this, fn)) as T | undefined;
        span.setAttributes(outcomeAttribute('passed'));
        for (const i of interactions) {
          writeAutoLedgerEntry({
            consumer,
            provider,
            interaction: i.uponReceiving,
            states: (i.states ?? []).map((s) => s.description),
            kind: 'http',
            outcome: 'passed',
            start,
          });
        }
        return result;
      } catch (error_) {
        span.setAttributes(outcomeAttribute('failed'));
        const error = error_ instanceof Error ? error_.message : String(error_);
        for (const i of interactions) {
          writeAutoLedgerEntry({
            consumer,
            provider,
            interaction: i.uponReceiving,
            states: (i.states ?? []).map((s) => s.description),
            kind: 'http',
            outcome: 'failed',
            start,
            error,
          });
        }
        throw error_;
      }
    });
  };

  proto[INSTALLED] = true;
}

function writeAutoLedgerEntry(args: {
  consumer: string;
  provider: string;
  interaction: string;
  states: string[];
  kind: 'message' | 'http';
  outcome: 'passed' | 'failed';
  start: bigint;
  error?: string;
}): void {
  const ctx = getActiveSpan()?.spanContext();
  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer: args.consumer,
    provider: args.provider,
    interaction: args.interaction,
    states: args.states,
    kind: args.kind,
    source: 'test',
    role: 'consumer',
    outcome: args.outcome,
    duration_ms: Number(process.hrtime.bigint() - args.start) / 1e6,
    observed_at: new Date().toISOString(),
    trace_id: ctx?.traceId,
    span_id: ctx?.spanId,
    run_id: process.env.AUTOTEL_PACT_RUN_ID,
    git_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA,
    error: args.error,
  };
  appendLedgerEntry(entry);
}

// Install on import — this file is meant to be loaded once as a setup file.
installAutoWrap();

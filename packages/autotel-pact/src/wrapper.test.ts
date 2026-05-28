import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLedger } from './ledger.js';
import { withPactInteraction, type MessageConsumerPactLike, type ReifiedMessage } from './wrapper.js';

class FakeMessagePact implements MessageConsumerPactLike {
  config = { consumer: 'OrderShipper', provider: 'OrderService' };
  recordedMetadata: Record<string, unknown> = {};

  constructor(
    private message: ReifiedMessage,
    private shouldFailHandler = false,
  ) {}

  withMetadata(metadata: Record<string, unknown>): this {
    Object.assign(this.recordedMetadata, metadata);
    return this;
  }

  async verify(handler: (msg: ReifiedMessage) => unknown): Promise<unknown> {
    if (this.shouldFailHandler) {
      throw new Error('handler rejected message');
    }
    return handler(this.message);
  }
}

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-wrap-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.AUTOTEL_PACT_RUN_ID;
});

const sampleMessage: ReifiedMessage = {
  contents: { orderId: 'ord-123' },
  description: 'an OrderCreated event',
  providerStates: [{ name: 'an order exists' }],
  metadata: { 'content-type': 'application/json' },
};

describe('withPactInteraction', () => {
  it('runs the handler and writes a passed ledger entry', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    const result = await withPactInteraction(
      pact,
      (msg) => ({ processed: (msg.contents as { orderId: string }).orderId }),
      { runId: 'r-pass' },
    );

    expect(result).toEqual({ processed: 'ord-123' });

    const entries = readLedger({ runId: 'r-pass' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: 'OrderShipper',
      provider: 'OrderService',
      interaction: 'an OrderCreated event',
      states: ['an order exists'],
      kind: 'message',
      outcome: 'passed',
    });
    expect(entries[0]!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(entries[0]!.observed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes a failed ledger entry when the handler throws', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    await expect(
      withPactInteraction(
        pact,
        () => {
          throw new Error('boom');
        },
        { runId: 'r-fail' },
      ),
    ).rejects.toThrow('boom');

    const entries = readLedger({ runId: 'r-fail' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ outcome: 'failed', error: 'boom' });
  });

  it('writes a failed ledger entry when pact.verify itself rejects', async () => {
    const pact = new FakeMessagePact(sampleMessage, true);
    await expect(
      withPactInteraction(pact, () => {}, { runId: 'r-verify-fail' }),
    ).rejects.toThrow('handler rejected message');

    const entries = readLedger({ runId: 'r-verify-fail' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outcome).toBe('failed');
  });

  it('persists interactionId on the ledger entry when supplied', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    await withPactInteraction(pact, () => 'ok', {
      runId: 'r-iid',
      interactionId: 'order.created.v1',
    });

    const entries = readLedger({ runId: 'r-iid' });
    expect(entries[0]!.interaction_id).toBe('order.created.v1');
  });

  it('writes interactionId into the pact message metadata so the audit can match both sides', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    await withPactInteraction(pact, () => 'ok', {
      runId: 'r-iid-meta',
      interactionId: 'order.created.v1',
    });

    // The metadata makes its way into the pact file via Pact-JS's
    // `withMetadata` API. The audit's `extractInteractionId` then reads it
    // back on the contracted side, so the row collapses with the ledger
    // (interaction_id-keyed) row instead of fragmenting.
    expect(pact.recordedMetadata.interactionId).toBe('order.created.v1');
  });

  it('does not touch withMetadata when interactionId is not supplied', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    await withPactInteraction(pact, () => 'ok', { runId: 'r-no-iid' });
    expect(pact.recordedMetadata).toEqual({});
  });

  it('throws a helpful error when consumer/provider cannot be resolved', async () => {
    // Pact-like with no config and no override — wrapper should refuse cleanly.
    const bare: MessageConsumerPactLike = {
      async verify(handler) {
        return handler(sampleMessage);
      },
    };
    await expect(
      withPactInteraction(bare, () => {}, { runId: 'r-no-cfg' }),
    ).rejects.toThrow(/could not resolve consumer\/provider/);
  });

  it('uses opts.consumer/provider fallbacks when the pact lacks config', async () => {
    const bare: MessageConsumerPactLike = {
      async verify(handler) {
        return handler(sampleMessage);
      },
    };
    await withPactInteraction(bare, () => {}, {
      runId: 'r-fallback',
      consumer: 'OverrideConsumer',
      provider: 'OverrideProvider',
    });

    const entries = readLedger({ runId: 'r-fallback' });
    expect(entries[0]).toMatchObject({
      consumer: 'OverrideConsumer',
      provider: 'OverrideProvider',
    });
  });

  it('records one ledger entry per interaction when the same pact instance is reused', async () => {
    const pact = new FakeMessagePact(sampleMessage);
    await withPactInteraction(pact, () => 'a', { runId: 'r-reuse' });
    await withPactInteraction(pact, () => 'b', { runId: 'r-reuse' });

    const entries = readLedger({ runId: 'r-reuse' });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.outcome === 'passed')).toBe(true);
  });
});

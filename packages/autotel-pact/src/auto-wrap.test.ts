import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAutoWrap } from './auto-wrap.js';
import { readLedger } from './ledger.js';

// We can't reuse the patched-once prototypes between tests cleanly —
// monkey-patching is by design a one-shot operation. So each test defines
// its own fresh fake classes, then installs the auto-wrap against them.

function makeFakeMessagePact() {
  return class FakeMessageConsumerPact {
    config = { consumer: 'A', provider: 'B' };
    async verify(handler: (m: unknown) => Promise<unknown>): Promise<unknown> {
      return handler({
        contents: { x: 1 },
        description: 'an evt',
        providerStates: [{ name: 'state-x' }],
      });
    }
  };
}

function makeFakePactV3() {
  return class FakePactV3 {
    opts = { consumer: 'Web', provider: 'Catalog' };
    added: Array<{ uponReceiving: string; states?: Array<{ description: string }> }> = [];
    addInteraction(interaction: {
      uponReceiving: string;
      states?: Array<{ description: string }>;
    }) {
      this.added.push(interaction);
      return this;
    }
    async executeTest<T>(
      fn: (s: { url: string; port: number }) => Promise<T>,
    ): Promise<T | undefined> {
      return fn({ url: 'http://localhost', port: 0 });
    }
  };
}

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-auto-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.AUTOTEL_PACT_RUN_ID;
});

describe('auto-wrap', () => {
  it('patches MessageConsumerPact.prototype.verify to emit a ledger entry', async () => {
    process.env.AUTOTEL_PACT_RUN_ID = 'r-auto-msg';
    const Pact = makeFakeMessagePact();
    installAutoWrap({
      MessageConsumerPact: Pact as unknown as { prototype: Record<string | symbol, unknown> },
    });

    const pact = new Pact();
    await pact.verify(async () => 'handled');

    const entries = readLedger({ runId: 'r-auto-msg' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: 'A',
      provider: 'B',
      interaction: 'an evt',
      states: ['state-x'],
      kind: 'message',
      outcome: 'passed',
    });
  });

  it('patches PactV3 so addInteraction + executeTest emits ledger entries', async () => {
    process.env.AUTOTEL_PACT_RUN_ID = 'r-auto-http';
    const Pact = makeFakePactV3();
    installAutoWrap({
      PactV3: Pact as unknown as { prototype: Record<string | symbol, unknown> },
    });

    const pact = new Pact();
    pact.addInteraction({
      uponReceiving: 'get widgets',
      states: [{ description: 'widgets exist' }],
    });
    await pact.executeTest(async () => {});

    const entries = readLedger({ runId: 'r-auto-http' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: 'Web',
      provider: 'Catalog',
      interaction: 'get widgets',
      states: ['widgets exist'],
      kind: 'http',
      outcome: 'passed',
    });
  });

  it('records failed outcome when the test body throws', async () => {
    process.env.AUTOTEL_PACT_RUN_ID = 'r-auto-fail';
    const Pact = makeFakePactV3();
    installAutoWrap({
      PactV3: Pact as unknown as { prototype: Record<string | symbol, unknown> },
    });

    const pact = new Pact();
    pact.addInteraction({ uponReceiving: 'broken' });

    await expect(
      pact.executeTest(async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');

    const entries = readLedger({ runId: 'r-auto-fail' });
    expect(entries[0]).toMatchObject({ outcome: 'failed', error: 'assertion failed' });
  });

  it('is idempotent — installing twice on the same prototype does not double-wrap', async () => {
    process.env.AUTOTEL_PACT_RUN_ID = 'r-auto-idem';
    const Pact = makeFakeMessagePact();
    installAutoWrap({
      MessageConsumerPact: Pact as unknown as { prototype: Record<string | symbol, unknown> },
    });
    installAutoWrap({
      MessageConsumerPact: Pact as unknown as { prototype: Record<string | symbol, unknown> },
    });

    const pact = new Pact();
    await pact.verify(async () => {});

    const entries = readLedger({ runId: 'r-auto-idem' });
    expect(entries).toHaveLength(1); // not 2
  });

  it('skips patching when no recognised ctors are present in the module', () => {
    // Empty module is a successful no-op — nothing crashes, nothing patched.
    expect(installAutoWrap({})).toBe(true);
  });
});

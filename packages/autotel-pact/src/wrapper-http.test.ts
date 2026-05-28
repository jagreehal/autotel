import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLedger } from './ledger.js';
import {
  withHttpPactInteraction,
  type HttpInteraction,
  type HttpPactLike,
} from './wrapper-http.js';

class FakeHttpPact implements HttpPactLike {
  opts = { consumer: 'Web', provider: 'Catalog' };
  added: HttpInteraction[] = [];

  constructor(private failTest = false) {}

  addInteraction(interaction: HttpInteraction): this {
    this.added.push(interaction);
    return this;
  }

  async executeTest<T>(
    testFn: (s: { url: string; port: number }) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.failTest) throw new Error('mock server failed to start');
    return testFn({ url: 'http://127.0.0.1:9999', port: 9999 });
  }
}

const sampleInteraction: HttpInteraction = {
  uponReceiving: 'get all products',
  states: [{ description: 'products exist' }],
  withRequest: { method: 'GET', path: '/products' },
  willRespondWith: { status: 200, body: [] },
};

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-http-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

describe('withHttpPactInteraction', () => {
  it('adds the interaction to the pact and records a passed entry', async () => {
    const pact = new FakeHttpPact();
    let saw: string | undefined;
    await withHttpPactInteraction(
      pact,
      sampleInteraction,
      async (server) => {
        saw = server.url;
      },
      { runId: 'r-http-pass' },
    );

    expect(saw).toBe('http://127.0.0.1:9999');
    expect(pact.added).toHaveLength(1);
    expect(pact.added[0]!.uponReceiving).toBe('get all products');

    const entries = readLedger({ runId: 'r-http-pass' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: 'Web',
      provider: 'Catalog',
      interaction: 'get all products',
      states: ['products exist'],
      kind: 'http',
      outcome: 'passed',
    });
  });

  it('records a failed entry when the test body throws', async () => {
    const pact = new FakeHttpPact();
    await expect(
      withHttpPactInteraction(
        pact,
        sampleInteraction,
        async () => {
          throw new Error('assertion failed');
        },
        { runId: 'r-http-fail' },
      ),
    ).rejects.toThrow('assertion failed');

    const entries = readLedger({ runId: 'r-http-fail' });
    expect(entries[0]).toMatchObject({ outcome: 'failed', error: 'assertion failed' });
  });

  it('records a failed entry when pact.executeTest itself throws', async () => {
    const pact = new FakeHttpPact(true);
    await expect(
      withHttpPactInteraction(pact, sampleInteraction, async () => {}, {
        runId: 'r-http-exec-fail',
      }),
    ).rejects.toThrow('mock server failed to start');

    const entries = readLedger({ runId: 'r-http-exec-fail' });
    expect(entries[0]!.outcome).toBe('failed');
  });

  it('rejects interactionId on HTTP with a clear error (no metadata channel in PactV3)', async () => {
    const pact = new FakeHttpPact();
    await expect(
      withHttpPactInteraction(pact, sampleInteraction, async () => {}, {
        runId: 'r-http-iid',
        interactionId: 'products.list.v1',
      }),
    ).rejects.toThrow(/interactionId.*not yet supported for HTTP/);
  });

  it('throws helpful error when consumer/provider cannot be resolved', async () => {
    const bare: HttpPactLike = {
      addInteraction: () => {},
      async executeTest(fn) {
        return fn({ url: 'http://localhost', port: 0 });
      },
    };
    await expect(
      withHttpPactInteraction(bare, sampleInteraction, async () => {}, {
        runId: 'r-http-no-cfg',
      }),
    ).rejects.toThrow(/could not resolve consumer\/provider/);
  });
});

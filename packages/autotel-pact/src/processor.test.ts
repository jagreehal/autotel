import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACT_ATTRS } from './attrs.js';
import { flushLedgerWrites, readLedger, resetLedgerWriteChainForTests } from './ledger.js';
import { PactLedgerSpanProcessor } from './processor.js';

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-proc-'));
  process.chdir(workDir);
  resetLedgerWriteChainForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

function fakeSpan(attrs: Record<string, unknown>) {
  return {
    attributes: attrs,
    spanContext: () => ({ traceId: 't1', spanId: 's1' }),
  };
}

describe('PactLedgerSpanProcessor', () => {
  it('writes production ledger entries for pact-tagged spans', async () => {
    const proc = new PactLedgerSpanProcessor({ runId: 'prod-1' });
    proc.onEnd(
      fakeSpan({
        [PACT_ATTRS.CONSUMER]: 'A',
        [PACT_ATTRS.PROVIDER]: 'B',
        [PACT_ATTRS.INTERACTION_DESCRIPTION]: 'evt',
        [PACT_ATTRS.KIND]: 'message',
      }),
    );
    await proc.forceFlush();

    const entries = readLedger({ runId: 'prod-1' });
    expect(entries).toHaveLength(1);
    if (entries[0]!.type === 'provider_verification_run') throw new Error('expected interaction');
    expect(entries[0]).toMatchObject({
      source: 'production',
      role: 'consumer',
      interaction: 'evt',
    });
  });

  it('does not throw when ledger write fails', async () => {
    const proc = new PactLedgerSpanProcessor({
      runId: 'x',
      dir: '/\0invalid',
      onWriteError: vi.fn(),
    });
    expect(() =>
      proc.onEnd(
        fakeSpan({
          [PACT_ATTRS.CONSUMER]: 'A',
          [PACT_ATTRS.PROVIDER]: 'B',
          [PACT_ATTRS.INTERACTION_DESCRIPTION]: 'evt',
        }),
      ),
    ).not.toThrow();
    await proc.forceFlush();
  });

  it('drops oldest when queue is full', async () => {
    const onDrop = vi.fn();
    const proc = new PactLedgerSpanProcessor({
      runId: 'drop',
      maxQueueSize: 1,
      onDrop,
      onWarn: () => {},
    });
    const span = fakeSpan({
      [PACT_ATTRS.CONSUMER]: 'A',
      [PACT_ATTRS.PROVIDER]: 'B',
      [PACT_ATTRS.INTERACTION_DESCRIPTION]: 'evt',
    });
    proc.onEnd(span);
    proc.onEnd(span);
    await proc.forceFlush();
    expect(onDrop).toHaveBeenCalled();
  });
});

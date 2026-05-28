import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLedgerEntry, ledgerPath, readLedger } from './ledger.js';
import { isInteractionLedgerEntry, type InteractionLedgerEntry } from './types.js';

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-test-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.AUTOTEL_PACT_RUN_ID;
  delete process.env.AUTOTEL_PACT_LEDGER_DIR;
});

import { LEDGER_ENTRY_SPEC } from './types.js';

function sampleEntry(overrides: Partial<InteractionLedgerEntry> = {}): InteractionLedgerEntry {
  return {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer: 'A',
    provider: 'B',
    interaction: 'evt',
    states: [],
    kind: 'message',
    source: 'test',
    role: 'consumer',
    outcome: 'passed',
    duration_ms: 1,
    observed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ledger', () => {
  it('writes JSONL entries that round-trip via readLedger', () => {
    const opts = { runId: 'r1' };
    appendLedgerEntry(sampleEntry({ interaction: 'one' }), opts);
    appendLedgerEntry(sampleEntry({ interaction: 'two' }), opts);

    const entries = readLedger(opts);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => (isInteractionLedgerEntry(e) ? e.interaction : ''))).toEqual([
      'one',
      'two',
    ]);
  });

  it('skips malformed lines silently', () => {
    const opts = { runId: 'r2' };
    appendLedgerEntry(sampleEntry({ interaction: 'good' }), opts);
    const path = ledgerPath(opts);
    // simulate corruption
    const { appendFileSync } = require('node:fs');
    appendFileSync(path, 'not-json\n', 'utf8');

    const entries = readLedger(opts);
    expect(entries).toHaveLength(1);
    expect(isInteractionLedgerEntry(entries[0]!) && entries[0].interaction).toBe('good');
  });

  it('reads multiple ledger files in the directory', () => {
    appendLedgerEntry(sampleEntry({ interaction: 'a' }), { runId: 'r-a' });
    appendLedgerEntry(sampleEntry({ interaction: 'b' }), { runId: 'r-b' });

    const entries = readLedger({});
    expect(
      entries
        .map((e) => (isInteractionLedgerEntry(e) ? e.interaction : ''))
        .toSorted(),
    ).toEqual(['a', 'b']);
  });

  it('returns an empty array when the ledger directory does not exist', () => {
    expect(readLedger({ dir: '.does-not-exist' })).toEqual([]);
  });

  it('honours AUTOTEL_PACT_RUN_ID', () => {
    process.env.AUTOTEL_PACT_RUN_ID = 'env-run';
    const path = ledgerPath({});
    expect(path).toMatch(/ledger-env-run\.jsonl$/);
  });
});

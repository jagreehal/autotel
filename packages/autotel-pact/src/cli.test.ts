import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';
import type { InteractionLedgerEntry, PactFile } from './types.js';
import { LEDGER_ENTRY_SPEC } from './types.js';

let workDir: string;
let originalCwd: string;
let stdoutChunks: string[];
let stderrChunks: string[];
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-cli-'));
  process.chdir(workDir);
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

function writePact(filename: string, file: PactFile): void {
  mkdirSync('pacts', { recursive: true });
  writeFileSync(path.join('pacts', filename), JSON.stringify(file));
}

function writeLedger(entries: InteractionLedgerEntry[]): void {
  mkdirSync('.autotel-pact', { recursive: true });
  writeFileSync(
    '.autotel-pact/ledger-x.jsonl',
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

function freshEntry(overrides: Partial<InteractionLedgerEntry> = {}): InteractionLedgerEntry {
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

describe('cli', () => {
  it('--help exits 0 and prints help', async () => {
    const code = await main(['--help']);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toContain('autotel-pact audit');
  });

  it('default mode prints a table and exits 0 even with stale confidence', async () => {
    writePact('A-B.json', { consumer: { name: 'A' }, provider: { name: 'B' }, messages: [{ description: 'evt' }] });
    const code = await main([]);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toMatch(/STALE/);
    expect(stdoutChunks.join('')).toContain('TEST_SEEN');
  });

  it('--gate exits 1 when contracted interactions are not seen in test', async () => {
    writePact('A-B.json', { consumer: { name: 'A' }, provider: { name: 'B' }, messages: [{ description: 'evt' }] });
    const code = await main(['--gate']);
    expect(code).toBe(1);
  });

  it('--gate=strict also fails on observed-but-not-contracted', async () => {
    writeLedger([freshEntry()]);
    const code = await main(['--gate=strict']);
    expect(code).toBe(1);
  });

  it('--gate=strict succeeds when all interactions are contracted and seen in test', async () => {
    writePact('A-B.json', { consumer: { name: 'A' }, provider: { name: 'B' }, messages: [{ description: 'evt' }] });
    writeLedger([freshEntry()]);
    const code = await main(['--gate=strict']);
    expect(code).toBe(0);
  });

  it('--json emits parseable JSON', async () => {
    writePact('A-B.json', { consumer: { name: 'A' }, provider: { name: 'B' }, messages: [{ description: 'evt' }] });
    const code = await main(['--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.counts.contracted_not_test_seen).toBe(1);
    expect(parsed.spec).toContain('v0.2.0');
  });

  it('rejects unknown args with exit 2', async () => {
    const code = await main(['--bogus']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Unknown argument/);
  });

  it('exits 2 when --pacts is given with no value', async () => {
    const code = await main(['--pacts']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Missing value for --pacts/);
  });

  it('exits 2 when --ledger is given with no value', async () => {
    const code = await main(['--ledger']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Missing value for --ledger/);
  });

  it('exits 2 when --pacts= is given with empty value', async () => {
    const code = await main(['--pacts=']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Missing value for --pacts/);
  });

  it('exits 2 when --ledger= is given with empty value', async () => {
    const code = await main(['--ledger=']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Missing value for --ledger/);
  });

  it('exits 2 when --window= is given with empty value', async () => {
    const code = await main(['--window=']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/Missing value for --window/);
  });
});

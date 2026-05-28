import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeLedgerRecord } from './ledger-normalize.js';
import { LEDGER_ENTRY_SPEC, type LedgerRecord } from './types.js';

export interface LedgerOptions {
  dir?: string;
  runId?: string;
}

const DEFAULT_DIR = '.autotel-pact';

function resolveLedgerDir(opts: LedgerOptions = {}): string {
  return path.resolve(process.cwd(), opts.dir ?? process.env.AUTOTEL_PACT_LEDGER_DIR ?? DEFAULT_DIR);
}

function resolveRunId(opts: LedgerOptions = {}): string {
  const explicit = opts.runId ?? process.env.AUTOTEL_PACT_RUN_ID;
  if (explicit) return explicit;
  return `local-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
}

export function ledgerPath(opts: LedgerOptions = {}): string {
  const dir = resolveLedgerDir(opts);
  return path.join(dir, `ledger-${resolveRunId(opts)}.jsonl`);
}

function writeLine(filePath: string, entry: LedgerRecord): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Append a ledger record synchronously (tests and consumer wrappers).
 */
export function appendLedgerEntry(
  entry: LedgerRecord,
  opts: LedgerOptions = {},
): void {
  const filePath = ledgerPath(opts);
  const normalized: LedgerRecord =
    entry.type === 'provider_verification_run'
      ? entry
      : { ...entry, spec: LEDGER_ENTRY_SPEC, type: 'interaction' as const };
  writeLine(filePath, normalized);
}

export function appendProviderVerificationFailure(
  entry: Omit<
    import('./types.js').ProviderVerificationRunEntry,
    'type' | 'spec' | 'outcome' | 'role'
  > & { error: string },
  opts: LedgerOptions = {},
): void {
  appendLedgerEntry(
    {
      type: 'provider_verification_run',
      spec: LEDGER_ENTRY_SPEC,
      outcome: 'failed',
      role: 'provider',
      source: entry.source ?? 'test',
      consumer: entry.consumer,
      provider: entry.provider,
      observed_at: entry.observed_at,
      error: entry.error,
      run_id: entry.run_id,
      git_sha: entry.git_sha,
      trace_id: entry.trace_id,
      span_id: entry.span_id,
    },
    opts,
  );
}

/**
 * Read all ledger files and return normalized records.
 */
export function readLedger(opts: LedgerOptions = {}): LedgerRecord[] {
  const dir = resolveLedgerDir(opts);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const entries: LedgerRecord[] = [];
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const normalized = normalizeLedgerRecord(JSON.parse(line));
        if (normalized) entries.push(normalized);
      } catch {
        // skip malformed lines
      }
    }
  }
  return entries;
}

/**
 * Serialized async writes for production span processor.
 * Bounded by a producer-side backpressure threshold: once `pendingWrites`
 * reaches `MAX_PENDING_WRITES`, new callers await drainage before queueing,
 * so memory cannot grow unbounded under sustained pressure.
 */
const MAX_PENDING_WRITES = 4096;
let asyncWriteChain: Promise<void> = Promise.resolve();
let pendingWrites = 0;

export async function appendLedgerEntryAsync(
  entry: LedgerRecord,
  opts: LedgerOptions = {},
): Promise<void> {
  if (pendingWrites >= MAX_PENDING_WRITES) {
    await asyncWriteChain;
  }

  const filePath = ledgerPath(opts);
  const normalized: LedgerRecord =
    entry.type === 'provider_verification_run'
      ? entry
      : { ...entry, spec: LEDGER_ENTRY_SPEC, type: 'interaction' as const };
  const line = JSON.stringify(normalized);

  pendingWrites++;
  const run = asyncWriteChain.then(async () => {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, line + '\n', 'utf8');
    } finally {
      pendingWrites--;
    }
  });
  asyncWriteChain = run.catch(() => {});
  return run;
}

export async function flushLedgerWrites(): Promise<void> {
  await asyncWriteChain;
}

/** @internal Reset async chain between tests. */
export function resetLedgerWriteChainForTests(): void {
  asyncWriteChain = Promise.resolve();
  pendingWrites = 0;
}

/** @internal Expose pending write count for tests. */
export function pendingLedgerWriteCount(): number {
  return pendingWrites;
}

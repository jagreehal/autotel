import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeAuditMatrix, runAuditSync } from './audit.js';
import type { InteractionLedgerEntry, PactFile } from './types.js';
import { AUDIT_MATRIX_SPEC, LEDGER_ENTRY_SPEC } from './types.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function entry(overrides: Partial<InteractionLedgerEntry>): InteractionLedgerEntry {
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
    observed_at: NOW.toISOString(),
    ...overrides,
  };
}

describe('computeAuditMatrix', () => {
  it('marks contracted-and-seen-in-test as OK', () => {
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [entry({})],
      now: NOW,
    });
    expect(m.counts).toMatchObject({ contracted_and_test_seen: 1, contracted_not_test_seen: 0 });
    expect(m.rows[0]).toMatchObject({ contracted: true, test_seen: true, observed: true });
  });

  it('flags contracted-but-not-seen-in-test (STALE)', () => {
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [],
      now: NOW,
    });
    expect(m.counts.contracted_not_test_seen).toBe(1);
    expect(m.rows[0]).toMatchObject({ contracted: true, test_seen: false });
  });

  it('flags seen-but-not-contracted', () => {
    const m = computeAuditMatrix({
      contracted: [],
      ledger: [entry({})],
      now: NOW,
    });
    expect(m.counts.test_or_prod_seen_not_contracted).toBe(1);
    expect(m.rows[0]).toMatchObject({ contracted: false, test_seen: true });
  });

  it('tracks prod_seen separately from test_seen', () => {
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [entry({ source: 'production' })],
      now: NOW,
    });
    expect(m.rows[0]).toMatchObject({
      test_seen: false,
      prod_seen: true,
    });
    expect(m.counts.contracted_not_test_seen).toBe(1);
  });

  it('sets provider_verified only for provider role passed entries', () => {
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [
        entry({ role: 'provider', outcome: 'passed' }),
      ],
      now: NOW,
    });
    expect(m.rows[0]!.provider_verified).toBe(true);
    expect(m.rows[0]!.test_seen).toBe(false);
  });

  it('ignores provider_verification_run for per-interaction columns', () => {
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [
        {
          type: 'provider_verification_run',
          spec: LEDGER_ENTRY_SPEC,
          consumer: 'A',
          provider: 'B',
          outcome: 'failed',
          source: 'test',
          role: 'provider',
          observed_at: NOW.toISOString(),
          error: 'setup failed',
        },
      ],
      now: NOW,
    });
    expect(m.rows[0]!.provider_verified).toBe(false);
    expect(m.verification_failures).toHaveLength(1);
  });

  it('applies broker_verified at pact-pair level', () => {
    const m = computeAuditMatrix({
      contracted: [
        { consumer: 'A', provider: 'B', interaction: 'evt1', kind: 'message' },
        { consumer: 'A', provider: 'B', interaction: 'evt2', kind: 'message' },
      ],
      ledger: [],
      brokerVerifications: [
        { consumer: 'A', provider: 'B', success: true, verifiedAt: NOW.toISOString() },
      ],
      now: NOW,
    });
    expect(m.rows.every((r) => r.broker_verified)).toBe(true);
    expect(m.counts.broker_verified).toBe(2);
  });

  it('excludes ledger entries outside the window', () => {
    const oldEntry = entry({
      observed_at: new Date(NOW.getTime() - 20 * DAY).toISOString(),
    });
    const m = computeAuditMatrix({
      contracted: [{ consumer: 'A', provider: 'B', interaction: 'evt', kind: 'message' }],
      ledger: [oldEntry],
      windowDays: 14,
      now: NOW,
    });
    expect(m.counts.contracted_not_test_seen).toBe(1);
  });

  it('emits v0.2 audit matrix spec', () => {
    const m = computeAuditMatrix({
      contracted: [],
      ledger: [],
      now: NOW,
    });
    expect(m.spec).toBe(AUDIT_MATRIX_SPEC);
  });
});

describe('runAuditSync (integration)', () => {
  let workDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-audit-'));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reads pacts and ledger from disk and produces a matrix', () => {
    mkdirSync('pacts', { recursive: true });
    const pact: PactFile = {
      consumer: { name: 'OrderShipper' },
      provider: { name: 'OrderService' },
      messages: [
        { description: 'an OrderCreated event' },
        { description: 'an OrderCancelled event' },
      ],
    };
    writeFileSync('pacts/OrderShipper-OrderService.json', JSON.stringify(pact));

    mkdirSync('.autotel-pact', { recursive: true });
    const observed = entry({
      consumer: 'OrderShipper',
      provider: 'OrderService',
      interaction: 'an OrderCreated event',
      observed_at: new Date().toISOString(),
    });
    writeFileSync('.autotel-pact/ledger-x.jsonl', JSON.stringify(observed) + '\n');

    const m = runAuditSync({});

    expect(m.counts.contracted).toBe(2);
    expect(m.counts.contracted_and_test_seen).toBe(1);
    expect(m.counts.contracted_not_test_seen).toBe(1);
  });
});

import path from 'node:path';
import { fetchBrokerVerifications, type BrokerConfig } from './broker.js';
import { readLedger, type LedgerOptions } from './ledger.js';
import {
  interactionsFromPactFile,
  listPactFiles,
  parsePactFile,
} from './pact-file.js';
import {
  AUDIT_MATRIX_SPEC,
  isInteractionLedgerEntry,
  isProviderVerificationRun,
  type AuditMatrix,
  type AuditRow,
  type BrokerVerification,
  type InteractionLedgerEntry,
  type LedgerRecord,
  type PactInteractionKey,
  type ProviderVerificationRunEntry,
} from './types.js';

export interface AuditOptions extends LedgerOptions {
  pactsDir?: string;
  windowDays?: number;
  broker?: BrokerConfig;
}

const DEFAULT_PACTS_DIR = './pacts';
const DEFAULT_WINDOW_DAYS = 14;

export function keyOf(k: PactInteractionKey): string {
  const identity = k.interactionId ?? k.interaction;
  return `${k.consumer}::${k.provider}::${k.kind}::${identity}`;
}

function pairKey(consumer: string, provider: string): string {
  return `${consumer}::${provider}`;
}

function inWindow(observedAt: string, cutoff: number): boolean {
  const t = Date.parse(observedAt);
  return Number.isFinite(t) && t >= cutoff;
}

/**
 * Compute the audit matrix from pact files, ledger, and optional broker data.
 */
export function computeAuditMatrix(input: {
  contracted: PactInteractionKey[];
  ledger: LedgerRecord[];
  brokerVerifications?: BrokerVerification[];
  windowDays?: number;
  now?: Date;
}): AuditMatrix {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const verificationFailures: ProviderVerificationRunEntry[] = [];
  const recentInteractions: InteractionLedgerEntry[] = [];

  for (const entry of input.ledger) {
    if (!inWindow(entry.observed_at, cutoff)) continue;
    if (isProviderVerificationRun(entry)) {
      verificationFailures.push(entry);
      continue;
    }
    if (isInteractionLedgerEntry(entry)) {
      recentInteractions.push(entry);
    }
  }

  const brokerByPair = new Map<string, BrokerVerification>();
  for (const b of input.brokerVerifications ?? []) {
    brokerByPair.set(pairKey(b.consumer, b.provider), b);
  }

  const testSeenByKey = new Map<string, InteractionLedgerEntry[]>();
  const prodSeenByKey = new Map<string, InteractionLedgerEntry[]>();
  const providerVerifiedByKey = new Map<string, InteractionLedgerEntry[]>();
  const anyObservedByKey = new Map<string, InteractionLedgerEntry[]>();

  for (const entry of recentInteractions) {
    const k = keyOf({
      consumer: entry.consumer,
      provider: entry.provider,
      interaction: entry.interaction,
      kind: entry.kind,
      interactionId: entry.interaction_id,
    });

    const push = (map: Map<string, InteractionLedgerEntry[]>) => {
      const arr = map.get(k) ?? [];
      arr.push(entry);
      map.set(k, arr);
    };

    push(anyObservedByKey);

    if (entry.source === 'test' && entry.role === 'consumer') {
      push(testSeenByKey);
    }
    if (entry.source === 'production') {
      push(prodSeenByKey);
    }
    if (entry.role === 'provider' && entry.outcome === 'passed') {
      push(providerVerifiedByKey);
    }
  }

  const contractedByKey = new Map<string, PactInteractionKey>();
  for (const c of input.contracted) {
    contractedByKey.set(keyOf(c), c);
  }

  const rows: AuditRow[] = [];

  function pushRow(parts: PactInteractionKey, k: string, isContracted: boolean): void {
    const testObs = testSeenByKey.get(k) ?? [];
    const prodObs = prodSeenByKey.get(k) ?? [];
    const providerObs = providerVerifiedByKey.get(k) ?? [];
    const allObs = anyObservedByKey.get(k) ?? [];
    const latest = allObs.toSorted((a, b) =>
      b.observed_at.localeCompare(a.observed_at),
    )[0];
    const broker = brokerByPair.get(pairKey(parts.consumer, parts.provider));

    rows.push({
      consumer: parts.consumer,
      provider: parts.provider,
      interaction: parts.interaction,
      interaction_id: parts.interactionId ?? latest?.interaction_id,
      kind: parts.kind,
      contracted: isContracted,
      observed: testObs.length > 0 || prodObs.length > 0,
      test_seen: testObs.length > 0,
      prod_seen: prodObs.length > 0,
      provider_verified: providerObs.length > 0,
      broker_verified: broker?.success === true,
      broker_verified_at: broker?.verifiedAt,
      broker_error: broker?.error,
      last_observed_at: latest?.observed_at,
      last_outcome: latest?.outcome,
    });
  }

  for (const [k, contracted] of contractedByKey) {
    pushRow(contracted, k, true);
  }
  for (const [k, observations] of anyObservedByKey) {
    if (contractedByKey.has(k)) continue;
    const first = observations[0]!;
    pushRow(
      {
        consumer: first.consumer,
        provider: first.provider,
        interaction: first.interaction,
        kind: first.kind,
        interactionId: first.interaction_id,
      },
      k,
      false,
    );
  }

  rows.sort((a, b) =>
    a.consumer.localeCompare(b.consumer) ||
    a.provider.localeCompare(b.provider) ||
    a.interaction.localeCompare(b.interaction),
  );

  const counts = {
    total: rows.length,
    contracted: rows.filter((r) => r.contracted).length,
    observed: rows.filter((r) => r.observed).length,
    contracted_and_test_seen: rows.filter((r) => r.contracted && r.test_seen).length,
    contracted_not_test_seen: rows.filter((r) => r.contracted && !r.test_seen).length,
    test_or_prod_seen_not_contracted: rows.filter(
      (r) => !r.contracted && (r.test_seen || r.prod_seen),
    ).length,
    test_seen: rows.filter((r) => r.test_seen).length,
    prod_seen: rows.filter((r) => r.prod_seen).length,
    provider_verified: rows.filter((r) => r.provider_verified).length,
    broker_verified: rows.filter((r) => r.broker_verified).length,
  };

  const matrix: AuditMatrix = {
    spec: AUDIT_MATRIX_SPEC,
    rows,
    counts,
    window_days: windowDays,
    generated_at: now.toISOString(),
  };

  if (verificationFailures.length > 0) {
    matrix.verification_failures = verificationFailures;
  }

  return matrix;
}

export async function runAudit(opts: AuditOptions = {}): Promise<AuditMatrix> {
  const pactsDir = path.resolve(process.cwd(), opts.pactsDir ?? DEFAULT_PACTS_DIR);
  const contracted: PactInteractionKey[] = [];
  const pairs = new Set<string>();

  for (const file of listPactFiles(pactsDir)) {
    const pact = parsePactFile(file);
    if (!pact) continue;
    const interactions = interactionsFromPactFile(pact);
    contracted.push(...interactions);
    const consumer = pact.consumer?.name;
    const provider = pact.provider?.name;
    if (consumer && provider) {
      pairs.add(pairKey(consumer, provider));
    }
  }

  const ledger = readLedger(opts);

  let brokerVerifications: BrokerVerification[] | undefined;
  if (opts.broker) {
    brokerVerifications = await fetchBrokerVerifications(opts.broker, [...pairs].map((p) => {
      const [consumer, provider] = p.split('::');
      return { consumer: consumer!, provider: provider! };
    }));
  }

  return computeAuditMatrix({
    contracted,
    ledger,
    brokerVerifications,
    windowDays: opts.windowDays,
  });
}

/** Sync audit without broker (backward compatible for tests). */
export function runAuditSync(opts: Omit<AuditOptions, 'broker'> = {}): AuditMatrix {
  const pactsDir = path.resolve(process.cwd(), opts.pactsDir ?? DEFAULT_PACTS_DIR);
  const contracted: PactInteractionKey[] = [];
  for (const file of listPactFiles(pactsDir)) {
    const pact = parsePactFile(file);
    if (pact) contracted.push(...interactionsFromPactFile(pact));
  }
  const ledger = readLedger(opts);
  return computeAuditMatrix({
    contracted,
    ledger,
    windowDays: opts.windowDays,
  });
}

/**
 * Kind of contract interaction observed.
 */
export type PactKind = 'message' | 'http';

export type PactOutcome = 'passed' | 'failed';

export type LedgerSource = 'test' | 'production';
export type LedgerRole = 'consumer' | 'provider';

export const LEDGER_ENTRY_SPEC = 'autotel-pact-ledger-entry/v0.2.0';
export const AUDIT_MATRIX_SPEC = 'autotel-pact-audit-matrix/v0.2.0';

/**
 * Metadata about a single Pact interaction, derived from the reified message
 * plus the consumer/provider config. Stamped onto the span and the ledger entry.
 */
export interface PactInteractionMeta {
  consumer: string;
  provider: string;
  description: string;
  states: string[];
  kind: PactKind;
  interactionId?: string;
}

/**
 * Per-interaction ledger evidence (consumer exercise, provider verify, or production tag).
 */
export interface InteractionLedgerEntry {
  type?: 'interaction';
  spec: typeof LEDGER_ENTRY_SPEC;
  consumer: string;
  provider: string;
  interaction: string;
  interaction_id?: string;
  states: string[];
  kind: PactKind;
  outcome: PactOutcome;
  source: LedgerSource;
  role: LedgerRole;
  duration_ms: number;
  observed_at: string;
  trace_id?: string;
  span_id?: string;
  run_id?: string;
  git_sha?: string;
  error?: string;
}

/**
 * Run-level provider verification failure — does not imply per-interaction outcomes.
 */
export interface ProviderVerificationRunEntry {
  type: 'provider_verification_run';
  spec: typeof LEDGER_ENTRY_SPEC;
  consumer: string;
  provider: string;
  outcome: 'failed';
  source: LedgerSource;
  role: 'provider';
  observed_at: string;
  error: string;
  run_id?: string;
  git_sha?: string;
  trace_id?: string;
  span_id?: string;
}

export type LedgerRecord = InteractionLedgerEntry | ProviderVerificationRunEntry;

export function isInteractionLedgerEntry(
  entry: LedgerRecord,
): entry is InteractionLedgerEntry {
  return entry.type !== 'provider_verification_run';
}

export function isProviderVerificationRun(
  entry: LedgerRecord,
): entry is ProviderVerificationRunEntry {
  return entry.type === 'provider_verification_run';
}

/**
 * Shape of a Pact contract file on disk (subset we read).
 */
export interface PactFile {
  consumer: { name: string };
  provider: { name: string };
  messages?: Array<{
    description: string;
    providerStates?: Array<{ name: string }>;
    metadata?: Record<string, unknown>;
  }>;
  interactions?: Array<{
    description: string;
    providerStates?: Array<{ name: string }>;
    metadata?: Record<string, unknown>;
  }>;
}

export interface BrokerVerification {
  consumer: string;
  provider: string;
  success: boolean;
  verifiedAt?: string;
  /**
   * Populated when the broker could not be reached or returned a non-2xx
   * response. Distinguishes "broker said the pact is not verified" (no error)
   * from "we could not determine verification status" (error set).
   */
  error?: string;
}

/**
 * One row in the audit matrix.
 */
export interface AuditRow {
  consumer: string;
  provider: string;
  interaction: string;
  interaction_id?: string;
  kind: PactKind;
  contracted: boolean;
  /** Any interaction-level ledger hit in the window (test or production). */
  observed: boolean;
  test_seen: boolean;
  prod_seen: boolean;
  provider_verified: boolean;
  broker_verified: boolean;
  broker_verified_at?: string;
  /** Set when the broker check failed (network error, non-2xx, parse error). */
  broker_error?: string;
  last_observed_at?: string;
  last_outcome?: PactOutcome;
}

export interface AuditMatrix {
  spec: typeof AUDIT_MATRIX_SPEC;
  rows: AuditRow[];
  counts: {
    total: number;
    /** Any contracted row. */
    contracted: number;
    /** Any row with test_seen OR prod_seen. */
    observed: number;
    /** Contracted AND seen in a consumer test. */
    contracted_and_test_seen: number;
    /** Contracted but not seen in a consumer test (stale confidence). */
    contracted_not_test_seen: number;
    /** Seen (test or production) without a matching contract (ungoverned flow). */
    test_or_prod_seen_not_contracted: number;
    test_seen: number;
    prod_seen: number;
    provider_verified: number;
    broker_verified: number;
  };
  window_days: number;
  generated_at: string;
  verification_failures?: ProviderVerificationRunEntry[];
}

export interface PactInteractionKey {
  consumer: string;
  provider: string;
  interaction: string;
  kind: PactKind;
  interactionId?: string;
}

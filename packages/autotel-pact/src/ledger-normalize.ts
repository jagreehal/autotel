import {
  LEDGER_ENTRY_SPEC,
  type InteractionLedgerEntry,
  type LedgerRecord,
  type ProviderVerificationRunEntry,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate a parsed JSONL line and return a typed ledger record.
 * Rejects anything that does not match the current v0.2 spec.
 */
export function normalizeLedgerRecord(parsed: unknown): LedgerRecord | null {
  if (!isRecord(parsed) || parsed.spec !== LEDGER_ENTRY_SPEC) return null;

  const { consumer, provider, observed_at } = parsed;
  if (
    typeof consumer !== 'string' ||
    typeof provider !== 'string' ||
    typeof observed_at !== 'string'
  ) {
    return null;
  }

  if (parsed.type === 'provider_verification_run') {
    if (typeof parsed.error !== 'string') return null;
    const entry: ProviderVerificationRunEntry = {
      type: 'provider_verification_run',
      spec: LEDGER_ENTRY_SPEC,
      consumer,
      provider,
      outcome: 'failed',
      source: parsed.source === 'production' ? 'production' : 'test',
      role: 'provider',
      observed_at,
      error: parsed.error,
    };
    if (typeof parsed.run_id === 'string') entry.run_id = parsed.run_id;
    if (typeof parsed.git_sha === 'string') entry.git_sha = parsed.git_sha;
    if (typeof parsed.trace_id === 'string') entry.trace_id = parsed.trace_id;
    if (typeof parsed.span_id === 'string') entry.span_id = parsed.span_id;
    return entry;
  }

  if (typeof parsed.interaction !== 'string') return null;

  const states = Array.isArray(parsed.states)
    ? parsed.states.filter((s): s is string => typeof s === 'string')
    : [];

  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer,
    provider,
    interaction: parsed.interaction,
    states,
    kind: parsed.kind === 'http' ? 'http' : 'message',
    outcome: parsed.outcome === 'failed' ? 'failed' : 'passed',
    source: parsed.source === 'production' ? 'production' : 'test',
    role: parsed.role === 'provider' ? 'provider' : 'consumer',
    duration_ms:
      typeof parsed.duration_ms === 'number' && parsed.duration_ms >= 0
        ? parsed.duration_ms
        : 0,
    observed_at,
  };

  if (typeof parsed.interaction_id === 'string' && parsed.interaction_id.length > 0) {
    entry.interaction_id = parsed.interaction_id;
  }
  if (typeof parsed.trace_id === 'string') entry.trace_id = parsed.trace_id;
  if (typeof parsed.span_id === 'string') entry.span_id = parsed.span_id;
  if (typeof parsed.run_id === 'string') entry.run_id = parsed.run_id;
  if (typeof parsed.git_sha === 'string') entry.git_sha = parsed.git_sha;
  if (typeof parsed.error === 'string') entry.error = parsed.error;

  return entry;
}

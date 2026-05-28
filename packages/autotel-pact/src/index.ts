export { withPactInteraction } from './wrapper.js';
export type {
  WithPactInteractionOptions,
  MessageConsumerPactLike,
  PactMessageHandler,
  ReifiedMessage,
} from './wrapper.js';

export { withHttpPactInteraction } from './wrapper-http.js';
export type {
  WithHttpPactInteractionOptions,
  HttpPactLike,
  HttpInteraction,
  HttpMockServer,
  HttpPactTestFn,
} from './wrapper-http.js';

export { withProviderVerification } from './wrapper-provider.js';
export type {
  WithProviderVerificationOptions,
  VerifierOptionsLike,
  VerifierLike,
  VerifierConstructor,
} from './wrapper-provider.js';

export {
  appendLedgerEntry,
  /**
   * Append a ledger record without blocking the caller. Shares an internal
   * serialized write chain with `PactLedgerSpanProcessor`; call
   * `flushLedgerWrites()` to wait for all pending writes to land.
   */
  appendLedgerEntryAsync,
  appendProviderVerificationFailure,
  readLedger,
  ledgerPath,
  /** Awaits the shared async write chain used by `appendLedgerEntryAsync`. */
  flushLedgerWrites,
} from './ledger.js';
export type { LedgerOptions } from './ledger.js';

export { buildPactAttributes, outcomeAttribute, PACT_ATTRS } from './attrs.js';
export type { PactAttributeKey } from './attrs.js';

export { tagPactInteraction } from './tag.js';

export { PactLedgerSpanProcessor, createPactLedgerProcessor } from './processor.js';
export type {
  PactLedgerProcessorOptions,
  ReadableSpanLike,
  SpanProcessorLike,
} from './processor.js';

export { runAudit, runAuditSync, computeAuditMatrix, keyOf } from './audit.js';
export type { AuditOptions } from './audit.js';

export {
  fetchBrokerVerifications,
  parseBrokerVerificationResult,
  brokerConfigFromEnv,
} from './broker.js';
export type { BrokerConfig, ConsumerProviderPair } from './broker.js';

export {
  interactionsFromPactFile,
  listPactFiles,
  parsePactFile,
} from './pact-file.js';

export {
  LEDGER_ENTRY_SPEC,
  AUDIT_MATRIX_SPEC,
  isInteractionLedgerEntry,
  isProviderVerificationRun,
} from './types.js';
export type {
  PactKind,
  PactOutcome,
  PactInteractionMeta,
  InteractionLedgerEntry,
  LedgerRecord,
  ProviderVerificationRunEntry,
  LedgerSource,
  LedgerRole,
  PactFile,
  AuditRow,
  AuditMatrix,
  BrokerVerification,
  PactInteractionKey,
} from './types.js';

// Downstream consumers building dashboards that explain why a broker
// verification is pair-level (not interaction-level) can surface this warning.
export { BROKER_GRANULARITY_WARNING } from './labels.js';

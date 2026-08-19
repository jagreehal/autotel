import type { PactInteractionMeta, PactOutcome } from './types.js';

/**
 * Attribute keys for Pact interactions. Centralised so the namespace is
 * a single source of truth and is forward-compatible with eventual OTel
 * semantic conventions.
 */
export const PACT_ATTRS = {
  CONSUMER: 'pact.consumer',
  PROVIDER: 'pact.provider',
  KIND: 'pact.kind',
  INTERACTION_DESCRIPTION: 'pact.interaction.description',
  INTERACTION_ID: 'pact.interaction.id',
  INTERACTION_STATES: 'pact.interaction.states',
  CONTRACT_FILE: 'pact.contract.file',
  OUTCOME: 'pact.outcome',
} as const;

export type PactAttributeKey = (typeof PACT_ATTRS)[keyof typeof PACT_ATTRS];

/**
 * Build the set of attributes to stamp on a span when an interaction is
 * about to be exercised. `outcome` is added later by the wrapper.
 */
export function buildPactAttributes(
  meta: PactInteractionMeta,
  opts: { contractFile?: string } = {},
) {
  // Present only when known: a contract file is not always on disk, and an
  // interaction id only exists once the broker has seen the interaction.
  const optional: Array<[string, string]> = [];
  if (opts.contractFile) {
    optional.push([PACT_ATTRS.CONTRACT_FILE, opts.contractFile]);
  }
  if (meta.interactionId) {
    optional.push([PACT_ATTRS.INTERACTION_ID, meta.interactionId]);
  }

  return Object.fromEntries<string | string[]>([
    [PACT_ATTRS.CONSUMER, meta.consumer],
    [PACT_ATTRS.PROVIDER, meta.provider],
    [PACT_ATTRS.KIND, meta.kind],
    [PACT_ATTRS.INTERACTION_DESCRIPTION, meta.description],
    [PACT_ATTRS.INTERACTION_STATES, meta.states],
    ...optional,
  ]);
}

/**
 * Helper that returns just the outcome attribute — stamped after the
 * handler resolves or rejects.
 */
export function outcomeAttribute(outcome: PactOutcome) {
  return { [PACT_ATTRS.OUTCOME]: outcome };
}

/**
 * Cardinality posture helpers.
 *
 * The old cardinality rule — "keep unique-value counts down" — was a constraint
 * invented because dashboards have pixels and a graph with 10k series is
 * unreadable to a human. An agent does not look at the graph; it reads the
 * spans. A high-cardinality field (the user id, the sender domain, the request
 * id) is then the single most useful attribute on a trace when the agent is
 * chasing one specific failure.
 *
 * So the contract lets you mark attributes `highCardinality: true` as a
 * deliberate signal, and this module turns that into a *protect list*: the keys
 * a redactor or span-name normalizer must NOT strip, even when an aggressive
 * default would otherwise drop them.
 */

import type { TelemetryContract } from './contract.js';

/**
 * Every attribute key in the contract flagged `highCardinality: true`, across
 * both common and per-span attributes. Feed this into a redaction/normalization
 * allow-list so the fields most useful to an agent reader survive.
 *
 * @example
 * ```ts
 * import { init } from 'autotel';
 * import { highCardinalityKeys } from 'autotel-schema';
 * import { contract } from './telemetry.contract';
 *
 * init({
 *   service: 'checkout',
 *   // keep user.id / request.id intact even under the strict redactor
 *   attributeRedactor: { allowKeys: highCardinalityKeys(contract), preset: 'strict' },
 * });
 * ```
 */
export function highCardinalityKeys(contract: TelemetryContract): string[] {
  const keys = new Set<string>();
  for (const [key, spec] of Object.entries(contract.commonAttributes ?? {})) {
    if (spec.highCardinality) keys.add(key);
  }
  for (const spanSpec of Object.values(contract.spans)) {
    for (const [key, spec] of Object.entries(spanSpec.attributes ?? {})) {
      if (spec.highCardinality) keys.add(key);
    }
  }
  return [...keys].toSorted();
}

/**
 * Predicate form of {@link highCardinalityKeys} — `true` when `key` is declared
 * high-cardinality anywhere in the contract. Useful inside a custom
 * `spanNameNormalizer` or redactor callback.
 */
export function isHighCardinalityKey(
  contract: TelemetryContract,
  key: string,
): boolean {
  if (contract.commonAttributes?.[key]?.highCardinality) return true;
  for (const spanSpec of Object.values(contract.spans)) {
    if (spanSpec.attributes?.[key]?.highCardinality) return true;
  }
  return false;
}

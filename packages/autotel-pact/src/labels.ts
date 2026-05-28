/**
 * Human-facing labels for CLI and docs. Internal JSON keeps machine keys.
 */

export const CLI_COLUMNS = {
  STATUS: 'STATUS',
  CONTRACTED: 'CONTRACTED',
  TEST_SEEN: 'TEST_SEEN',
  PROD_SEEN: 'PROD_SEEN',
  PROVIDER_VERIFIED: 'PROVIDER_VERIFIED',
  BROKER_VERIFIED: 'BROKER_VERIFIED',
  PAIR: 'CONSUMER → PROVIDER',
  KIND: 'KIND',
  INTERACTION: 'INTERACTION',
} as const;

export function formatYesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export const EVIDENCE_THEME =
  'We do not guess. We record evidence.';

export const BROKER_GRANULARITY_WARNING =
  'Broker verification proves the latest pact between a consumer and provider was verified. It does not prove each interaction was individually observed by autotel-pact.';

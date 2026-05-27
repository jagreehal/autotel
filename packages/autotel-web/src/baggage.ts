/**
 * Business-context propagation for autotel-web (W3C Baggage)
 *
 * Lets you attach key/value context (e.g. `tenant.id`) that travels with every
 * instrumented request as a W3C `baggage` header AND is tagged onto every
 * browser-recorded span. On the backend, autotel's BaggageSpanProcessor copies
 * these entries onto server spans — so one attribute appears end-to-end.
 *
 * NO OpenTelemetry dependencies - just a module-level string map and the
 * native `baggage` header format (https://www.w3.org/TR/baggage/).
 *
 * @example
 * ```typescript
 * import { init, setBaggage } from 'autotel-web';
 *
 * init({ service: 'my-spa' });
 *
 * // After login / tenant resolution:
 * setBaggage({ 'tenant.id': 'acme' });
 *
 * // Every subsequent same-origin fetch/XHR carries:  baggage: tenant.id=acme
 * // and every browser span is tagged with  tenant.id=acme
 * ```
 */

/**
 * Maximum serialized `baggage` header size in bytes.
 * Matches the W3C Baggage spec recommended maximum total length. Entries that
 * would push the header past this budget are dropped (with a debug warning)
 * rather than sent, so we never produce an oversized header.
 */
export const MAX_BAGGAGE_BYTES = 8192;

/**
 * Valid baggage key characters per the W3C Baggage spec (RFC 7230 token).
 * Note `.` is allowed, so keys like `tenant.id` are valid.
 */
const VALID_KEY = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

// Module-level context map. Insertion order is preserved for stable headers.
let entries: Map<string, string> = new Map();

/**
 * Validate a single key/value pair. Returns a reason string if invalid, or
 * null if valid. Pure — no side effects, safe to unit-test.
 */
export function validateBaggageEntry(
  key: unknown,
  value: unknown,
): string | null {
  if (typeof key !== 'string' || key.length === 0) {
    return 'key must be a non-empty string';
  }
  if (!VALID_KEY.test(key)) {
    return `key "${key}" contains characters not allowed in a baggage key`;
  }
  if (typeof value !== 'string') {
    return `value for "${key}" must be a string (got ${typeof value})`;
  }
  return null;
}

/**
 * Serialize baggage entries to a W3C `baggage` header value.
 *
 * Values are percent-encoded. If the serialized header would exceed
 * {@link MAX_BAGGAGE_BYTES}, trailing entries are dropped to stay within budget.
 * Returns `undefined` when there are no entries to send.
 *
 * Pure — takes entries explicitly so it can be unit-tested without module state.
 */
export function serializeBaggage(
  source: ReadonlyMap<string, string> | Record<string, string>,
): string | undefined {
  const pairs =
    source instanceof Map ? [...source.entries()] : Object.entries(source);
  if (pairs.length === 0) return undefined;

  const parts: string[] = [];
  let bytes = 0;
  for (const [key, value] of pairs) {
    const part = `${key}=${encodeURIComponent(value)}`;
    // +1 for the joining comma on every entry after the first.
    const addedBytes = part.length + (parts.length > 0 ? 1 : 0);
    if (bytes + addedBytes > MAX_BAGGAGE_BYTES) break;
    parts.push(part);
    bytes += addedBytes;
  }

  return parts.length > 0 ? parts.join(',') : undefined;
}

/**
 * Merge entries into the active baggage context (additive, like Sentry
 * `setTags` / Datadog `setGlobalContextProperty`). Invalid entries are dropped;
 * with `debug` enabled, each dropped entry logs a warning. Never throws.
 *
 * @param record - key/value context to merge (e.g. `{ 'tenant.id': 'acme' }`)
 * @param debug - when true, warn about dropped invalid entries
 */
export function setBaggage(
  record: Record<string, string>,
  debug = false,
): void {
  if (record == null || typeof record !== 'object') {
    if (debug) {
      console.warn('[autotel-web] setBaggage: expected an object of string values');
    }
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    const reason = validateBaggageEntry(key, value);
    if (reason) {
      if (debug) console.warn(`[autotel-web] setBaggage: dropped entry — ${reason}`);
      continue;
    }
    entries.set(key, value as string);
  }
}

/**
 * Remove a single baggage key, or clear all baggage when called with no key.
 */
export function clearBaggage(key?: string): void {
  if (key === undefined) {
    entries.clear();
  } else {
    entries.delete(key);
  }
}

/**
 * Current baggage entries as a plain object. Used to tag browser-recorded spans.
 * Returns a fresh copy; mutating it does not affect stored state.
 */
export function getBaggageEntries(): Record<string, string> {
  return Object.fromEntries(entries);
}

/**
 * Build the W3C `baggage` header value for the current context, or `undefined`
 * when there is no baggage to send.
 */
export function getBaggageHeader(): string | undefined {
  return serializeBaggage(entries);
}

/**
 * Whether any baggage is currently set.
 */
export function hasBaggage(): boolean {
  return entries.size > 0;
}

/**
 * Decide whether the `baggage` header may be sent to a request destination.
 *
 * Fail-closed: same-origin is always allowed; cross-origin destinations are
 * allowed ONLY if they match one of `allowedOrigins` (substring match, the same
 * convention used by PrivacyManager). This prevents customer-identifying
 * baggage (e.g. tenant.id) from leaking to third-party origins by default.
 *
 * This is intentionally about the destination only — privacy suppression
 * (DNT/GPC/blocked origins) is applied separately by ANDing with the
 * traceparent decision, so baggage never travels wider than traceparent.
 *
 * Pure — `currentOrigin` is passed in so it can be unit-tested without `window`.
 *
 * @param url - request URL (absolute or relative)
 * @param currentOrigin - the page origin (e.g. `window.location.origin`)
 * @param allowedOrigins - cross-origin hosts permitted to receive baggage
 */
export function isBaggageDestinationAllowed(
  url: string,
  currentOrigin: string,
  allowedOrigins: readonly string[] = [],
): boolean {
  let targetOrigin: string;
  try {
    targetOrigin =
      url.startsWith('http://') || url.startsWith('https://')
        ? new URL(url).origin
        : new URL(url, currentOrigin || 'http://localhost').origin;
  } catch {
    // Unparseable URL — fail closed.
    return false;
  }

  // Same-origin is always allowed.
  if (currentOrigin && targetOrigin === currentOrigin) return true;

  // Cross-origin only via explicit allowlist (substring match for parity with
  // PrivacyManager.allowedOrigins).
  const t = targetOrigin.toLowerCase();
  return allowedOrigins.some((o) => t.includes(o.toLowerCase()));
}

/**
 * Reset module state (for testing).
 * @internal
 */
export function resetBaggageForTesting(): void {
  entries = new Map();
}

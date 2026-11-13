/* oxlint-disable anti-slop/no-runtime-typeof -- This walker decodes external structured log values, including invalid runtime input, before applying typed redaction rules. */

import type { AnyValue, Attributes, AttributeValue } from '@opentelemetry/api';
import type { AttributeRedactorFn } from './attribute-redacting-processor';
import { asString } from './values';

const MAX_DEPTH = 32;
const TOO_DEEP = '[REDACTED: nested too deep]';
const CIRCULAR = '[Circular]';
const NOT_A_LOG_VALUE = '[REDACTED: not a log value]';
/** What a key rule sees in place of bytes, which have no text of their own. */
const BINARY = '[binary]';

/**
 * A comparable form of a value, or undefined when there is none (a cycle, a
 * BigInt): undefined never matches, so such a value counts as changed.
 */
export function fingerprint(value: AnyValue): string | undefined {
  if (value === null || typeof value !== 'object') {
    return `${typeof value}:${String(value)}`;
  }
  try {
    // Bytes print as a hash, at any depth: their JSON is a key per byte.
    return `json:${JSON.stringify(
      value,
      function (this: Record<string, AnyValue>, key, nested: AnyValue) {
        const raw = this[key];
        return raw instanceof Uint8Array ? bytesPrint(raw) : nested;
      },
    )}`;
  } catch {
    return undefined;
  }
}

/** Bytes as their length and FNV-1a hash. */
function bytesPrint(bytes: Uint8Array): string {
  let hash = 0x81_1c_9d_c5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01_00_01_93);
  return `bytes:${bytes.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Redact a value at any depth. A sensitive key is checked before its value
 * is entered, so `{ password: { value: 'x' } }` is redacted through the
 * parent's rule rather than only by what `password.value` happens to match;
 * `ruleKey` carries that parent down to every leaf beneath it.
 */
export function createRedactionWalker(
  redact: AttributeRedactorFn,
  isSensitive: (key: string) => boolean,
  siblings: Attributes,
  sticky: Map<string, AnyValue> = new Map(),
) {
  // The objects on the current path, so only a real cycle is cut: an object
  // referenced twice side by side is redacted both times.
  const ancestors = new WeakSet<object>();
  // Once a value under a key has been redacted for this record, it stays
  // redacted, whatever the context says later: a processor may replace a
  // sibling with something derived from its masked view (dropping the
  // entry that made the record private), and a redaction must never be
  // undone by that. Keyed by position and value, so a moved or re-derived
  // copy of the same value is caught too.
  const stick = (key: string, value: AnyValue, out: AnyValue): AnyValue => {
    const print = fingerprint(value);
    if (print === undefined) return out;
    const id = `${key}\u0000${print}`;
    if (fingerprint(out) !== print) {
      sticky.set(id, out);
      return out;
    }
    return sticky.has(id) ? sticky.get(id)! : out;
  };

  const walk = (
    key: string,
    value: AnyValue,
    ruleKey = key,
    depth = 0,
  ): AnyValue => {
    if (value === null || value === undefined) return value;
    if (value instanceof Uint8Array) {
      // No text for a value rule to read, but a key rule (this key's or a
      // sensitive ancestor's) covers bytes as it covers anything: they go as
      // the mask that rule gives, never as the original bytes.
      const masked = redact(ruleKey, BINARY, siblings);
      return stick(
        key,
        value,
        isSensitive(ruleKey) || masked !== BINARY ? masked : value,
      );
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      // Not a log value (the SDK only validates attributes, not the body),
      // and one that would break every copy made of the record downstream.
      return NOT_A_LOG_VALUE;
    }
    if (typeof value !== 'object') {
      return stick(key, value, redact(ruleKey, value, siblings));
    }
    if (depth >= MAX_DEPTH) return TOO_DEEP;
    if (ancestors.has(value)) return CIRCULAR;
    ancestors.add(value);
    try {
      return enter(key, value, ruleKey, depth);
    } finally {
      ancestors.delete(value);
    }
  };

  const enter = (
    key: string,
    // oxlint-disable-next-line anti-slop/no-object-parameters -- This is an unread object at the recursive decoding boundary.
    value: object,
    ruleKey: string,
    depth: number,
  ): AnyValue => {
    // The sensitive key every leaf below must be redacted under, if any:
    // one inherited from an ancestor, or this key itself.
    const sensitive =
      ruleKey === key ? (isSensitive(key) ? key : undefined) : ruleKey;
    const child = (name: string) => (key ? `${key}.${name}` : name);

    if (Array.isArray(value)) {
      // SAFETY: every element is checked as a string before this array is
      // passed to the attribute redactor as an AttributeValue.
      // A string array is one attribute value to the redactor, as on a
      // span, so a sensitive key replaces every element.
      return value.every((item) => asString(item) !== undefined)
        ? stick(
            key,
            value,
            redact(sensitive ?? key, value as AttributeValue, siblings),
          )
        : value.map((item) => walk(key, item, sensitive ?? key, depth + 1));
    }
    // SAFETY: entries come from the structured value map and are recursively
    // inspected by walk before they reach the attribute redactor.
    return Object.fromEntries(
      Object.entries(value).map(([name, nested]) => [
        name,
        walk(
          child(name),
          nested as AnyValue,
          sensitive ?? child(name),
          depth + 1,
        ),
      ]),
    );
  };
  return walk;
}

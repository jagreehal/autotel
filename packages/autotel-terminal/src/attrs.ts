/**
 * Reading attributes off a span the terminal received.
 *
 * A span arrives over OTLP, so its attribute values are whatever the sender
 * put there. Every screen that reads one wants the same thing - the string it
 * should display - and asking for it in one place keeps that decision out of
 * the twelve call sites that used to assert the type themselves.
 */

/** What an attribute holds once OTLP's AnyValue wrapper is unwrapped. */
export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null>;

/** A span's attribute bag, as the terminal stores it. */
export type SpanAttributes = Record<string, AttributeValue>;

/** The string an attribute carries, or undefined when it carried something else. */
export function stringAttr(
  attrs: SpanAttributes | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attrs?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** The number an attribute carries, or undefined when it carried something else. */
export function numberAttr(
  attrs: SpanAttributes | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = attrs?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

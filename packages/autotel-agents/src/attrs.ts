/**
 * Attribute coercion helpers. OTLP attributes arrive as strings, numbers or
 * booleans depending on the SDK (Claude Code emits some numbers as strings,
 * e.g. `success: "true"`), so every read goes through a coercer.
 */

import type { Attributes, AttrValue } from './types';

export function str(attrs: Attributes, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined || value === null || value instanceof Object)
      continue;
    const text = String(value);
    if (text.length > 0) return text;
  }
  return undefined;
}

export function num(attrs: Attributes, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined || value === null || value instanceof Object)
      continue;
    // A boolean is not a measurement: `success: true` must not read as 1.
    if (value === true || value === false) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && String(value).trim() !== '') return parsed;
  }
  return undefined;
}

export function bool(
  attrs: Attributes,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
  }
  return undefined;
}

/** Read a value without coercion (for pass-through into `AgentEvent.attributes`). */
export function raw(attrs: Attributes, key: string): AttrValue | undefined {
  return attrs[key];
}

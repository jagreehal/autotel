/**
 * Attribute coercion helpers. OTLP attributes arrive as strings, numbers or
 * booleans depending on the SDK (Claude Code emits some numbers as strings,
 * e.g. `success: "true"`), so every read goes through a coercer.
 */

import type { Attributes, AttrValue } from './types';

export function str(attrs: Attributes, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

export function num(attrs: Attributes, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && value.trim() !== '') return parsed;
    }
  }
  return undefined;
}

export function bool(attrs: Attributes, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
  }
  return undefined;
}

/** Read a value without coercion (for pass-through into `AgentEvent.attributes`). */
export function raw(attrs: Attributes, key: string): AttrValue | undefined {
  return attrs[key];
}

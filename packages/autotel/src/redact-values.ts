/* oxlint-disable anti-slop/no-unknown-parameters -- Public redaction accepts unread external payloads; the shared walker is their decoding boundary. */

/** Standalone redaction for use outside the span and log processor pipelines. */

import {
  createAttributeRedactor,
  createSensitiveKeyTest,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
} from './attribute-redacting-processor';
import { asRecord, asString } from './values';
import type { AnyValue, Attributes } from '@opentelemetry/api';
import { createRedactionWalker } from './redaction-walker';

export type StringRedactor = (value: string) => string;

/**
 * The span redactor's value rules for a bare string: value patterns and their
 * masks, built-in patterns, custom patterns and a custom `redactor`, so a
 * string and a span attribute holding the same value redact the same way. Key
 * rules cannot apply, since a bare string has no key.
 */
export function createStringRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): StringRedactor {
  const redact = createAttributeRedactor(config);
  return (value: string): string => {
    const result = redact('', value);
    return asString(result) ?? String(result);
  };
}

/** A redacted copy, whose fields may change type when a rule masks a value. */
export type ValueRedactor = (value: unknown) => AnyValue;

/**
 * The span and log redactor's rules for a structured value, without init().
 * Walks nested objects and arrays under dotted keys, preserving diagnostic
 * fields and applying the configured partial masks. Uses the same cycle and
 * depth limits as exported logs and never mutates the input. A throwing getter
 * or custom redactor hides the whole value rather than leaking the original.
 *
 * Pass a serialised Error (for example pino.stdSerializers.err(error)) to keep
 * its non-enumerable message and stack. Rules cannot recognise arbitrary PII
 * in free text; add application-specific key rules for fields such as names.
 */
export function createValueRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset = 'default',
): ValueRedactor {
  const redact = createAttributeRedactor(config);
  const sensitive = createSensitiveKeyTest(config);
  return (value: unknown): AnyValue => {
    try {
      // SAFETY: the walker is the same runtime boundary as the log processor:
      // it checks each leaf before passing scalars to the attribute redactor.
      // Sibling-aware rules read the root map, as they do for log attributes.
      const siblings = (asRecord(value) ?? {}) as Attributes;
      const walk = createRedactionWalker(redact, sensitive, siblings);
      return walk('', value);
    } catch {
      return '[REDACTED: redaction failed]';
    }
  };
}

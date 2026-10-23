/** Standalone string redaction for use outside the span processor pipeline. */

import {
  createAttributeRedactor,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
} from './attribute-redacting-processor';
import { asString } from './values';

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

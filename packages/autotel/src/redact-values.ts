/** Standalone string redaction for use outside the span processor pipeline. */

import {
  REDACTOR_PRESETS,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
  type ValuePatternConfig,
} from './attribute-redacting-processor';

export type StringRedactor = (value: string) => string;
export function createStringRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): StringRedactor {
  const resolved =
    typeof config === 'string' ? REDACTOR_PRESETS[config] : config;
  const valuePatterns: ValuePatternConfig[] = resolved.valuePatterns ?? [];
  const defaultReplacement = resolved.replacement ?? '[REDACTED]';

  return (value: string): string => {
    let result = value;
    for (const { pattern, replacement } of valuePatterns) {
      pattern.lastIndex = 0;
      result = result.replaceAll(pattern, replacement ?? defaultReplacement);
    }
    return result;
  };
}

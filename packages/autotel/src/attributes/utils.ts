/**
 * Attribute utility functions
 */

import type { Attributes } from '@opentelemetry/api';
import type { AttributeValue } from '../trace-context';
import {
  validateAttribute,
  autoRedactPII,
  defaultGuardrails,
  checkDeprecatedAttribute,
  type AttributePolicy,
} from './validators';

// Type for objects that have setAttributes method (spans or contexts)
// Using a generic parameter to accommodate different AttributeValue types
type AttributeSetter = {
  setAttributes: (attrs: Record<string, AttributeValue>) => void;
};

export function mergeAttrs(
  ...attrSets: Array<Attributes | undefined>
): Attributes {
  const result: Attributes = {};
  for (const attrSet of attrSets) {
    if (attrSet) {
      Object.assign(result, attrSet);
    }
  }
  return result;
}

export function safeSetAttributes(
  span: AttributeSetter,
  attrs: Attributes,
  policy?: AttributePolicy,
): void {
  // Merge user-supplied guardrails with defaults so callers can tweak
  // a single option without opting out of the rest
  const mergedGuardrails = {
    ...defaultGuardrails(),
    ...policy?.guardrails,
  };
  const effectivePolicy: AttributePolicy = {
    ...policy,
    guardrails: mergedGuardrails,
  };

  const validated = autoRedactPII(attrs, effectivePolicy);

  const sanitizedAttrs: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      // Check for deprecated attributes and log warnings
      checkDeprecatedAttribute(key, effectivePolicy);
      const validatedValue = validateAttribute(key, value, effectivePolicy);
      if (validatedValue !== undefined) {
        sanitizedAttrs[key] = validatedValue;
      }
    }
  }

  span.setAttributes(sanitizedAttrs);
}

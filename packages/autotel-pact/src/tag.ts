import { getActiveSpan } from 'autotel';
import { buildPactAttributes, PACT_ATTRS } from './attrs.js';
import type { PactInteractionMeta } from './types.js';

/**
 * Stamp `pact.*` attributes on the active span for production observation.
 * Requires an active span (wrap handlers with `trace()` first).
 */
export function tagPactInteraction(meta: PactInteractionMeta): void {
  const span = getActiveSpan();
  if (!span) {
    throw new Error(
      'autotel-pact: tagPactInteraction requires an active span. Wrap the handler with trace() first.',
    );
  }
  const attrs = buildPactAttributes(meta);
  span.setAttributes(attrs);
  if (meta.interactionId) {
    span.setAttribute(PACT_ATTRS.INTERACTION_ID, meta.interactionId);
  }
}

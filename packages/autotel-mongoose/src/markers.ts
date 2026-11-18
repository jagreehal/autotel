/** The markers autotel leaves on what it wrapped, so a second install wraps nothing twice. */

import type { Span } from 'autotel';

export const INSTRUMENTED_FLAG = '__autotelMongooseInstrumented' as const;
/**
 * Autotel marks what it has already wrapped so a second install is a no-op.
 * The marker lives on functions and prototypes this package does not own, so
 * these two helpers hold the only assertions needed to read and write it.
 */
type MarkerKey = string | symbol;

/** What a marker holds: that the value was wrapped, or the span stored on it. */
type MarkerValue = boolean | Span | undefined;

type Marked = Record<MarkerKey, MarkerValue>;

export function hasMarker(target: object, key: MarkerKey): boolean {
  // SAFETY: reading an own property that may not exist; absent reads undefined.
  return Boolean((target as Marked)[key]);
}

export function setMarker(
  target: object,
  key: MarkerKey,
  value: MarkerValue = true,
): void {
  // SAFETY: the marker is autotel's own key on a value autotel just wrapped.
  (target as Marked)[key] = value;
}

export const WRAPPED_HOOK_FLAG = '__autotelWrappedHook' as const;
export const WRAPPED_METHOD_FLAG = '__autotelWrappedMethod' as const;
export const MODEL_PATCHED_FLAG = '__autotelModelPatched' as const;
/**
 * Set on the replacement autotel installs over a Mongoose prototype method.
 *
 * `Model`, `Query.prototype` and `Model.prototype` come from the mongoose
 * module, so every `new mongoose.Mongoose()` shares them. The
 * already-instrumented guard sits on the Mongoose instance, which cannot see
 * that: instrumenting a second instance wrapped the same methods again, and one
 * `find()` then opened a span per layer.
 */
export const PATCHED_PROTOTYPE_FLAG = '__autotelPatchedPrototype' as const;

export const PROXIED_COLLECTION_FLAG = '__autotelProxiedCollection' as const;

/**
 * Symbol used to store the parent span on Query/Aggregate objects.
 * This preserves context across chainable query methods.
 */
export const _STORED_PARENT_SPAN: unique symbol = Symbol('stored-parent-span');

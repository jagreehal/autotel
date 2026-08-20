import type { AttributeValue } from './trace-context';
import { isFunction } from './values';

/** A flat, dot-namespaced attribute bag, as OTel carries one. */
export interface CorrelatedAttributes {
  [key: string]: AttributeValue;
}

export interface CorrelatedEventTarget {
  setAttribute(key: string, value: AttributeValue): void;
  setAttributes(attrs: CorrelatedAttributes): void;
  addEvent?(name: string, attrs?: CorrelatedAttributes): void;
}

// OTel attribute keys are dot-namespaced flat strings; we keep `.`/`-`/`_` and
// drop everything else so user-supplied event names can't break attribute keys.
function sanitizeEventKey(input: string): string {
  return input.replaceAll(/[^a-zA-Z0-9_.-]/g, '_');
}

// Per-target sequence so the fallback path can encode multiple events with the
// same name without one overwriting the previous (attributes are
// last-write-wins; events are not). Today the addEvent path is always taken;
// this keeps the fallback correct if/when the runtime stops binding addEvent.
const sequenceByTarget = new WeakMap<object, number>();

function nextSequence(target: CorrelatedEventTarget): number {
  const n = (sequenceByTarget.get(target) ?? 0) + 1;
  sequenceByTarget.set(target, n);
  return n;
}

export function emitCorrelatedEvent(
  ctx: CorrelatedEventTarget,
  name: string,
  attrs: CorrelatedAttributes = {},
): void {
  const eventName = sanitizeEventKey(name);
  if (isFunction(ctx.addEvent)) {
    ctx.addEvent.call(ctx, eventName, attrs);
    return;
  }
  const seq = nextSequence(ctx);
  const prefix = `autotel.event.${seq}.${eventName}`;
  const flattened: CorrelatedAttributes = {
    [`${prefix}.name`]: eventName,
    [`${prefix}.ts`]: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(attrs)) {
    flattened[`${prefix}.${sanitizeEventKey(k)}`] = v;
  }
  ctx.setAttributes(flattened);
}

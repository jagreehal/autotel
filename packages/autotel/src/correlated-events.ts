import type { AttributeValue } from './trace-context';

export interface CorrelatedEventTarget {
  setAttribute(key: string, value: AttributeValue): unknown;
  setAttributes(attrs: Record<string, AttributeValue>): unknown;
  addEvent?(name: string, attrs?: Record<string, AttributeValue>): unknown;
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

function nextSequence(target: object): number {
  const n = (sequenceByTarget.get(target) ?? 0) + 1;
  sequenceByTarget.set(target, n);
  return n;
}

export function emitCorrelatedEvent(
  ctx: CorrelatedEventTarget,
  name: string,
  attrs: Record<string, AttributeValue> = {},
): void {
  const eventName = sanitizeEventKey(name);
  if (typeof ctx.addEvent === 'function') {
    ctx.addEvent.call(ctx, eventName, attrs);
    return;
  }
  const seq = nextSequence(ctx);
  const prefix = `autotel.event.${seq}.${eventName}`;
  const flattened: Record<string, AttributeValue> = {
    [`${prefix}.name`]: eventName,
    [`${prefix}.ts`]: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(attrs)) {
    flattened[`${prefix}.${sanitizeEventKey(k)}`] = v;
  }
  ctx.setAttributes(flattened);
}

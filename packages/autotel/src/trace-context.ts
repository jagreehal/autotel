/**
 * Trace context types and utilities
 */

import type {
  AttributeValue as OtelAttributeValue,
  Span,
  Baggage,
  BaggageEntry,
  Context,
  Link,
} from '@opentelemetry/api';
import {
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace as otelTrace,
} from '@opentelemetry/api';
// namespace import for browser-bundler compat; `import type` is erased — see node-require.ts
import { emitOtelEvent } from './otel-event';
import type { AsyncLocalStorage } from 'node:async_hooks';
import * as nodeAsyncHooks from 'node:async_hooks';
import { flattenToAttributes, toAttributeValue } from './flatten-attributes';
import { recordStructuredError, toError } from './structured-error';
import { track } from './track';
import type { UnknownRecord } from './values';
import { isFunction } from './values';

const explicitSpanStatuses = new WeakMap<Span, SpanStatusCode>();

/**
 * The status the code explicitly chose for this span, if any: through a
 * TraceContext, or through the plain OpenTelemetry API on the span itself
 * (`getActiveSpan().setStatus(...)`), which the SDK span records as `status`.
 */
export function explicitSpanStatus(span: Span): SpanStatusCode | undefined {
  const chosen = explicitSpanStatuses.get(span);
  if (chosen !== undefined) return chosen;
  const recorded = (span as { status?: { code?: SpanStatusCode } }).status
    ?.code;
  return recorded === undefined || recorded === SpanStatusCode.UNSET
    ? undefined
    : recorded;
}

/** Mark a span that finished without throwing as OK, keeping a status the code chose. */
export function markSpanOk(span: Span): void {
  if (explicitSpanStatus(span) === undefined) {
    span.setStatus({ code: SpanStatusCode.OK });
  }
}

type AsyncLocalBox<T> = {
  value: T;
};

/**
 * AsyncLocalStorage for storing the active context with baggage
 * This allows setters to update the context and have it persist
 */
const contextStorage = new nodeAsyncHooks.AsyncLocalStorage<
  AsyncLocalBox<Context>
>();

/**
 * Get the context storage instance (for initialization in functional.ts)
 */
export function getContextStorage(): AsyncLocalStorage<AsyncLocalBox<Context>> {
  return contextStorage;
}

/**
 * Get the active OTel context with ctx's baggage writes applied.
 * Span identity always comes from the active OTel scope.
 *
 * ctx's setters write to the request's store, which outlives OTel scopes, so
 * the active context can be older than a write (a parent's context restored
 * after a child's ctx.setBaggage()) or newer (a `context.with()` entered after
 * it: featureFlagBaggage at the edge, or an explicit override). Each context
 * ctx enters is marked with a sequence number and the baggage it carried, and
 * every context derived from it inherits the mark. For a key ctx wrote after
 * the active context's mark, the active entry is stale if it is the one the
 * mark carried (an inherited entry, or inherited absence) or one a later ctx
 * write replaced; any other entry, or a removal, is a change made since, and
 * wins. Everything else is the active context's.
 */
export function getActiveContextWithBaggage(): Context {
  const activeContext = context.active();
  const stored = contextStorage.getStore()?.value;
  // SAFETY: KEY_WRITES is module-private and writeBaggage() is the only
  // writer, always with a KeyWrites map.
  const writes = stored?.getValue(KEY_WRITES) as KeyWrites | undefined;
  if (!stored || !writes) return activeContext;

  const own = new Map(propagation.getBaggage(stored)?.getAllEntries());
  const activeBaggage =
    propagation.getBaggage(activeContext) ?? propagation.createBaggage();
  // SAFETY: WRITE_MARK is module-private; writeBaggage() and
  // contextWithBaggage() set it, always to a WriteMark.
  const mark = activeContext.getValue(WRITE_MARK) as WriteMark | undefined;
  let merged = activeBaggage;
  for (const [key, write] of writes) {
    if (mark && write.seq <= mark.seq) continue;
    const active = rawEntry(activeBaggage, key);
    // Stale: the entry the mark carried (or its absence), or one a ctx write
    // replaced, which a context.with() entered before that write still holds.
    const inherited =
      (active !== undefined && write.stale.has(active)) ||
      (mark ? active === rawEntry(mark.baggage, key) : active === undefined);
    if (!inherited) continue;
    const entry = own.get(key);
    merged = entry ? merged.setEntry(key, entry) : merged.removeEntry(key);
  }
  return merged === activeBaggage
    ? activeContext
    : propagation.setBaggage(activeContext, merged);
}

/**
 * The current baggage with `entries` set, for a scope autotel enters around a
 * callback. Marked like a write: its entries date from now, so a child's
 * ctx.setBaggage() after it reads as newer once the child returns.
 */
export function contextWithBaggage(entries: Record<string, string>): Context {
  const current = getActiveContextWithBaggage();
  let baggage = propagation.getBaggage(current) ?? propagation.createBaggage();
  for (const [key, value] of Object.entries(entries))
    baggage = baggage.setEntry(key, { value });
  return propagation
    .setBaggage(current, baggage)
    .setValue(WRITE_MARK, { seq: ++writeSeq, baggage } satisfies WriteMark);
}

/** The entry object itself: `getEntry()` returns a copy, so identity is lost. */
function rawEntry(baggage: Baggage, key: string): BaggageEntry | undefined {
  return baggage.getAllEntries().find(([k]) => k === key)?.[1];
}

/** On contexts ctx's setters enter: when, and the baggage they carried. */
const WRITE_MARK = createContextKey('autotel.baggage.write_mark');
type WriteMark = { seq: number; baggage: Baggage };

/**
 * On the stored context: for each key ctx's setters wrote or deleted, the
 * latest write's sequence number and the entries it replaced. Those entries
 * identify stale values in a context entered before ctx wrote anything.
 */
const KEY_WRITES = createContextKey('autotel.baggage.key_writes');
type KeyWrites = ReadonlyMap<
  string,
  { seq: number; stale: ReadonlySet<BaggageEntry> }
>;
let writeSeq = 0;

/** A UTF-16 surrogate without its pair: not Unicode, and not URI-encodable. */
export const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');

/** `text` with each lone surrogate replaced by U+FFFD. */
export function wellFormed(text: string): string {
  return text.replaceAll(LONE_SURROGATES, '\uFFFD');
}

/**
 * Run `fn` with the request store ctx's baggage setters write to, opened as a
 * run() scope so it ends with `fn`; an enclosing trace's store is reused.
 * Without one, writes are refused rather than entered into a scope that would
 * outlive the request.
 */
export function runWithTraceContextStorage<TResult>(
  fn: () => TResult,
): TResult {
  if (contextStorage.getStore()) return fn();
  return contextStorage.run({ value: context.active() }, fn);
}

/**
 * Set a value in AsyncLocalStorage, preferring enterWith() when available
 * (Node.js) and falling back to run() for environments that only support
 * run() (e.g. Cloudflare Workers).
 *
 * On runtimes without enterWith() we mutate the existing run() scope when one
 * exists. This is what allows baggage/correlation updates to remain visible
 * for the rest of the traced callback in Workers.
 */
export function enterOrRun<T>(
  storage: AsyncLocalStorage<AsyncLocalBox<T>>,
  value: T,
): void {
  const existingStore = storage.getStore();
  if (existingStore) {
    existingStore.value = value;
    return;
  }

  const boxedValue = { value };
  try {
    storage.enterWith(boxedValue);
  } catch {
    // Cloudflare Workers define enterWith but throw at runtime
    storage.run(boxedValue, () => {});
  }
}

/**
 * Try to keep OpenTelemetry's context manager in sync with baggage updates
 */
type ContextManagerLike = {
  with?: (ctx: Context, fn: () => void) => void;
  _asyncLocalStorage?: { enterWith?: (ctx: Context) => void };
};

/**
 * Apply one of ctx's baggage writes: an entry per key, `undefined` to delete.
 *
 * The store holds the request's own baggage, so it takes the change over what
 * it already had: built from the merged view instead, it would keep entries a
 * `context.with()` meant for one callback (featureFlagBaggage at the edge)
 * after that callback ends. The active context takes the change over the
 * merged view, so code after the write in the same scope sees everything.
 * Both get the same entry objects, which is what identity checks compare.
 */
export function writeBaggage(
  requested: Map<string, BaggageEntry | undefined>,
): boolean {
  // Lone surrogates become U+FFFD: the propagator URI-encodes every entry on
  // each outgoing call, and one it cannot encode makes that call throw.
  const changes = new Map(
    [...requested].map(([key, entry]) => [
      wellFormed(key),
      entry && { ...entry, value: wellFormed(entry.value) },
    ]),
  );
  const apply = (baggage: Baggage) => {
    let next = baggage;
    for (const [key, entry] of changes)
      next = entry ? next.setEntry(key, entry) : next.removeEntry(key);
    return next;
  };
  const store = contextStorage.getStore();
  if (!store) {
    // Outside an autotel trace, a write needs a scope to end with. Inside an
    // OTel context.with() (an auto-instrumented request's span) entering the
    // context is confined to that callback and what it starts. At the root
    // nothing bounds it: it would reach everything later on this async chain,
    // the next request included.
    const active = context.active();
    if (active === ROOT_CONTEXT) return false;
    const baggage =
      propagation.getBaggage(active) ?? propagation.createBaggage();
    enterActiveContext(propagation.setBaggage(active, apply(baggage)));
    return true;
  }

  const current = getActiveContextWithBaggage();
  const currentBaggage =
    propagation.getBaggage(current) ?? propagation.createBaggage();
  const previous = store.value;
  // A store with no baggage yet owns none: the merged view would hand it
  // entries scoped to the active context.
  const own = propagation.getBaggage(previous) ?? propagation.createBaggage();

  const seq = ++writeSeq;
  const writes = new Map(
    // SAFETY: as in getActiveContextWithBaggage(): only writeBaggage() sets
    // KEY_WRITES, always to a KeyWrites map.
    previous.getValue(KEY_WRITES) as KeyWrites | undefined,
  );
  for (const key of changes.keys()) {
    const stale = new Set(writes.get(key)?.stale);
    for (const before of [currentBaggage, own]) {
      const entry = rawEntry(before, key);
      if (entry) stale.add(entry);
    }
    writes.set(key, { seq, stale });
  }

  // Update our storage first so any helper reads see the new context
  store.value = propagation
    .setBaggage(current, apply(own))
    .setValue(KEY_WRITES, writes);
  const entered = apply(currentBaggage);
  enterActiveContext(
    propagation
      .setBaggage(current, entered)
      .setValue(WRITE_MARK, { seq, baggage: entered } satisfies WriteMark),
  );
  return true;
}

function enterActiveContext(newContext: Context): void {
  // SAFETY: the ContextAPI does not expose its manager, and there is no
  // callback-free way to enter a context without it. Every member below is
  // optional and probed before use, so an API without them takes the fallback.
  const contextWithManager = context as unknown as {
    _getContextManager?: () => ContextManagerLike;
  };

  const manager = contextWithManager._getContextManager?.();
  if (!manager) return;

  const asyncLocal =
    // SAFETY: as above - the storage and its enterWith are both probed.
    (manager as { _asyncLocalStorage?: { enterWith?: (ctx: Context) => void } })
      ._asyncLocalStorage ?? undefined;
  if (asyncLocal?.enterWith) {
    asyncLocal.enterWith(newContext);
    return;
  }

  if (isFunction(manager.with)) {
    manager.with(newContext, () => {});
  }
}

/**
 * Base trace context containing trace identifiers
 */
export interface TraceContextBase {
  traceId: string;
  spanId: string;
  correlationId: string;
}

/**
 * Attribute value types following OpenTelemetry specification.
 * Supports primitive values and arrays of homogeneous primitives.
 */
export type AttributeValue = OtelAttributeValue;

/**
 * Span methods available on trace context
 */
export interface SpanMethods {
  /**
   * Set a single attribute on the span.
   *
   * A scalar or homogeneous array is recorded as given. Anything richer - a
   * nested object, a `Map`, a `Set`, a `Date` - is flattened to dot-notation
   * keys (`client.rights` + `{ admin: true }` gives `client.rights.admin`),
   * the same rule the request logger and structured errors follow.
   */
  setAttribute(key: string, value: unknown): void;
  /** Set multiple attributes on the span, flattened as {@link setAttribute} does */
  setAttributes(attrs: UnknownRecord): void;
  /** Set the status of the span */
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  /**
   * Add a link to another span. `null` and `undefined` are skipped, so the
   * result of `createLinkFromHeaders()` (null without a traceparent) can be
   * passed straight in.
   */
  addLink(link: Link | null | undefined): void;
  /** Add multiple links to other spans, skipping `null` and `undefined` */
  addLinks(links: ReadonlyArray<Link | null | undefined>): void;
  /** Update the span name dynamically */
  updateName(name: string): void;
  /** Check if the span is recording */
  isRecording(): boolean;
  /**
   * Record an error on the span: sets ERROR status, structured `error.*`
   * attributes (including `why`/`fix`/`link` from `createStructuredError`),
   * and during the OTel Span Event API back-compat window also records the
   * exception via the legacy span event API.
   *
   * Replaces the deprecated `recordException` (OTEP 4430). Accepts `unknown`
   * so it can be called directly with the value caught from a `catch` block.
   */
  recordError(cause: unknown): void;
  /**
   * Record an event that happened during this span, as an OpenTelemetry log
   * record at INFO severity: `name` is the record's `eventName`, body and
   * `event.name` attribute, and the record carries this span's trace and span
   * id. The Logs API model that replaces `Span.addEvent` (OTEP 4430), and
   * the same call as autotel-web's `s.event`. Rich values are flattened as {@link setAttribute}
   * does. Exported by default once there is an endpoint;
   * `init({ logs: false })` drops it, with a one-time warning. Never throws.
   */
  event(name: string, attributes?: UnknownRecord): void;
  /**
   * Send a product event to the configured subscribers (PostHog, Mixpanel, …)
   * with the active span's trace id attached. Equivalent to the standalone
   * `track(event, data)`. Not an OpenTelemetry event: use {@link event} for one.
   */
  track<Events extends UnknownRecord = UnknownRecord>(
    event: keyof Events & string,
    data?: Events[keyof Events & string],
  ): void;
}

/**
 * Baggage methods available on trace context
 *
 * @template TBaggage - Optional type for typed baggage (defaults to undefined for untyped)
 */
export interface BaggageMethods<
  TBaggage extends UnknownRecord | undefined = undefined,
> {
  /**
   * Get a baggage entry by key
   * @param key - Baggage key
   * @returns Baggage entry value or undefined
   */
  getBaggage(key: string): string | undefined;

  /**
   * Set a baggage entry
   *
   * Note: OpenTelemetry contexts are immutable. For proper scoping across async
   * boundaries, use withBaggage() instead. This method updates baggage in the
   * current context which may not propagate to all child operations.
   *
   * @param key - Baggage key
   * @param value - Baggage value
   * @returns The baggage value that was set (for chaining)
   *
   * @example Using withBaggage() (recommended)
   * ```typescript
   * await withBaggage({ baggage: { 'key': 'value' }, fn: async () => {
   *   // Baggage is available here and in child spans
   * });
   * ```
   */
  setBaggage(key: string, value: string): string;

  /**
   * Delete a baggage entry
   *
   * Note: OpenTelemetry contexts are immutable. For proper scoping across async
   * boundaries, use withBaggage() with only the entries you want instead.
   *
   * @param key - Baggage key
   */
  deleteBaggage(key: string): void;

  /**
   * Get all baggage entries
   * @returns Map of all baggage entries
   */
  getAllBaggage(): Map<string, BaggageEntry>;

  /**
   * Get typed baggage (only available when TBaggage is defined)
   * This is used internally by defineBaggageSchema()
   *
   * @internal
   */
  getTypedBaggage?: TBaggage extends UnknownRecord
    ? <T extends TBaggage>(namespace?: string) => Partial<T> | undefined
    : never;

  /**
   * Set typed baggage (only available when TBaggage is defined)
   * This is used internally by defineBaggageSchema()
   *
   * @internal
   */
  setTypedBaggage?: TBaggage extends UnknownRecord
    ? <T extends TBaggage>(
        namespace: string | undefined,
        value: Partial<T>,
      ) => void
    : never;
}

/**
 * Complete trace context that merges base context, span methods, and baggage methods
 *
 * This is the ctx parameter passed to `withTracing()` factories and the value
 * returned by `getActiveTraceContext()` inside plain `trace()` wrappers.
 *
 * @template TBaggage - Optional type for typed baggage support
 *
 * @example Untyped (default)
 * ```typescript
 * export const handler = withTracing({})((ctx) => async () => {
 *   ctx.getBaggage('key'); // returns string | undefined
 * });
 * ```
 *
 * @example Typed baggage
 * ```typescript
 * type TenantBaggage = { tenantId: string; region?: string };
 *
 * export const handler = trace(async () => {
 *   const ctx = getActiveTraceContext<TenantBaggage>()!;
 *   // Use typed schema helper for type-safe access
 *   const schema = defineBaggageSchema<TenantBaggage>('tenant');
 *   const tenant = schema.get(ctx); // Partial<TenantBaggage> | undefined
 * });
 * ```
 */
export type TraceContext<
  TBaggage extends UnknownRecord | undefined = undefined,
> = TraceContextBase & SpanMethods & BaggageMethods<TBaggage>;

/** Key under which a `TraceContext` carries its span. */
const TRACE_CONTEXT_SPAN = Symbol.for('autotel.traceContext.span');

/**
 * Create a TraceContext from an OpenTelemetry Span
 *
 * This utility extracts trace context information from a span
 * and provides span manipulation methods and baggage operations in a consistent format.
 *
 * Note: Baggage methods always operate on the currently active context,
 * which may differ from the context when createTraceContext was called.
 */
export function createTraceContext<
  TBaggage extends UnknownRecord | undefined = undefined,
>(span: Span): TraceContext<TBaggage> {
  const spanContext = span.spanContext();

  // Baggage helpers that always use the current active context
  // This ensures baggage operations work correctly even if context changes
  const baggageHelpers: BaggageMethods<TBaggage> = {
    getBaggage(key: string): string | undefined {
      // The same merged view nested traces and outgoing calls propagate:
      // ctx.setBaggage() updates plus anything a later context.with() changed.
      const baggage = propagation.getBaggage(getActiveContextWithBaggage());
      return baggage?.getEntry(key)?.value;
    },

    setBaggage(key: string, value: string): string {
      writeBaggage(new Map([[key, { value }]]));
      return value;
    },

    deleteBaggage(key: string): void {
      writeBaggage(new Map([[key, undefined]]));
    },

    getAllBaggage(): Map<string, BaggageEntry> {
      const baggage = propagation.getBaggage(getActiveContextWithBaggage());
      if (!baggage) {
        return new Map();
      }

      // Convert baggage entries to a Map
      const entries = new Map<string, BaggageEntry>();
      for (const [key, entry] of baggage.getAllEntries()) {
        entries.set(key, entry);
      }
      return entries;
    },

    // Typed baggage helpers (used by defineBaggageSchema)
    // SAFETY: the conditional type at the end of this member makes it present
    // only when the context declares a baggage schema; the cast bridges the
    // implementation's own signature to that conditional.
    getTypedBaggage: (<T extends UnknownRecord>(namespace?: string) => {
      const baggage = propagation.getBaggage(getActiveContextWithBaggage());
      if (!baggage) return;

      const prefix = namespace ? `${namespace}.` : '';
      const entries: Array<[string, string]> = [];

      for (const [key, entry] of baggage.getAllEntries()) {
        if (namespace && key.startsWith(prefix)) {
          entries.push([key.slice(prefix.length), entry.value]);
        } else if (!namespace) {
          entries.push([key, entry.value]);
        }
      }

      // SAFETY: baggage travels as string entries; the caller's schema names
      // which of those keys it expects, and Partial says any of them may be
      // absent from the header this request arrived with.
      const result = Object.fromEntries(entries) as Partial<T>;
      return entries.length > 0 ? result : undefined;
    }) as TBaggage extends UnknownRecord
      ? <T extends TBaggage>(namespace?: string) => Partial<T> | undefined
      : never,

    // SAFETY: as above, for the setter.
    setTypedBaggage: (<T extends UnknownRecord>(
      namespace: string | undefined,
      value: Partial<T>,
    ) => {
      const prefix = namespace ? `${namespace}.` : '';
      const entries = Object.entries(value)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => [`${prefix}${key}`, String(val)] as const);
      writeBaggage(new Map(entries.map(([key, val]) => [key, { value: val }])));
    }) as TBaggage extends UnknownRecord
      ? <T extends TBaggage>(
          namespace: string | undefined,
          value: Partial<T>,
        ) => void
      : never,
  };

  // `recordException` and `addEvent` are intentionally bound at runtime but
  // omitted from the `SpanMethods` type. They exist solely so existing call
  // sites keep working through the OTel Span Event API deprecation window
  // (see MIGRATION.md). New code MUST go through `recordStructuredError`,
  // `emitCorrelatedEvent`, or the request logger. The cast below is what hides
  // these compatibility-only fields from the public type.
  // SAFETY: the object below implements TraceContext member by member; the
  // assertion at the end of it supplies the baggage members, which are present
  // only when a schema was declared.
  const traceCtx = {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    correlationId: spanContext.traceId.slice(0, 16),
    setAttribute: (key: string, value: unknown) => {
      // One conversion rule with `setAttributes` below. A value OTel cannot
      // record - an object, a `Map`, a failed measurement - reads as undefined
      // here and goes to the flattener, which names it or spreads it into
      // dot-notation keys.
      const attr = toAttributeValue(value);
      if (attr === undefined) {
        span.setAttributes(flattenToAttributes({ [key]: value }));
        return;
      }
      span.setAttribute(key, attr);
    },
    setAttributes: (attrs: UnknownRecord) => {
      // Straight through the flattener, never a peek at the values first: a
      // getter that throws must be one key's failure marker rather than an
      // exception on the caller's path. Scalars come out of it unchanged.
      span.setAttributes(flattenToAttributes(attrs));
    },
    setStatus: (status: { code: SpanStatusCode; message?: string }) => {
      explicitSpanStatuses.set(span, status.code);
      span.setStatus(status);
    },
    recordException: span.recordException.bind(span),
    addEvent: span.addEvent.bind(span),
    addLink: (link: Link | null | undefined) => {
      if (link) span.addLink(link);
    },
    addLinks: (links: ReadonlyArray<Link | null | undefined>) => {
      const present = links.filter((link): link is Link => link != null);
      if (present.length > 0) span.addLinks(present);
    },
    updateName: span.updateName.bind(span),
    isRecording: span.isRecording.bind(span),
    recordError: (cause: unknown) => {
      try {
        recordStructuredError(traceCtx, toError(cause));
      } catch {
        // Recording an error never fails the traced code.
      }
    },
    event: (name: string, attributes?: UnknownRecord) => {
      try {
        emitOtelEvent(
          name,
          flattenToAttributes(attributes ?? {}),
          // This span, not whichever is active: ctx can outlive an `await`.
          otelTrace.setSpan(context.active(), span),
        );
      } catch {
        // An event must not become the reason the traced code fails.
      }
    },
    track: (event: string, data?: UnknownRecord) => {
      track(event, data);
    },
    ...baggageHelpers,
    // The span itself, for code that must tell spans apart through wrappers:
    // the ambient `ctx` and every `getActiveTraceContext()` view forward it.
    // A symbol, so spreads copy it and serialisers skip it.
    [TRACE_CONTEXT_SPAN]: span,
  } as unknown as TraceContext<TBaggage>;

  return traceCtx;
}

/**
 * Define a typed baggage schema for type-safe baggage operations
 *
 * This helper provides a type-safe API for working with baggage entries.
 * The namespace parameter is optional and prefixes all keys to avoid collisions.
 *
 * @template T - The baggage schema type (all fields are treated as optional)
 * @param namespace - Optional namespace to prefix baggage keys
 *
 * @example Basic usage
 * ```typescript
 * type TenantBaggage = { tenantId: string; region?: string };
 * const tenantBaggage = defineBaggageSchema<TenantBaggage>('tenant');
 *
 * export const handler = trace<TenantBaggage>((ctx) => async () => {
 *   // Get typed baggage
 *   const tenant = tenantBaggage.get(ctx);
 *   if (tenant?.tenantId) {
 *     console.log('Tenant:', tenant.tenantId);
 *   }
 *
 *   // Set typed baggage
 *   tenantBaggage.set(ctx, { tenantId: 't1', region: 'us-east-1' });
 * });
 * ```
 *
 * @example With withBaggage helper
 * ```typescript
 * const tenantBaggage = defineBaggageSchema<TenantBaggage>('tenant');
 *
 * export const handler = trace<TenantBaggage>((ctx) => async () => {
 *   return await tenantBaggage.with(ctx, { tenantId: 't1' }, async () => {
 *     // Baggage is available here and in child spans
 *     const tenant = tenantBaggage.get(ctx);
 *   });
 * });
 * ```
 */
export function defineBaggageSchema<T extends UnknownRecord>(
  namespace?: string,
) {
  return {
    /**
     * Get typed baggage from context
     * @param ctx - Trace context
     * @returns Partial baggage object or undefined if no baggage is set
     */
    get: (ctx: TraceContext<T>): Partial<T> | undefined => {
      if (!ctx.getTypedBaggage) return undefined;
      return ctx.getTypedBaggage<T>(namespace);
    },

    /**
     * Set typed baggage in context
     *
     * Note: For proper scoping across async boundaries, use the `with` method instead
     *
     * @param ctx - Trace context
     * @param value - Partial baggage object to set
     */
    set: (ctx: TraceContext<T>, value: Partial<T>): void => {
      if (!ctx.setTypedBaggage) return;
      ctx.setTypedBaggage<T>(namespace, value);
    },

    /**
     * Run a function with typed baggage properly scoped
     *
     * This is the recommended way to set baggage as it ensures proper
     * scoping across async boundaries.
     *
     * @param ctx - Trace context (can be omitted, will use active context)
     * @param value - Partial baggage object to set
     * @param fn - Function to execute with the baggage
     */
    with: <R>(
      ctxOrValue: TraceContext<T> | Partial<T>,
      valueOrFn: Partial<T> | (() => R | Promise<R>),
      maybeFn?: () => R | Promise<R>,
    ): R | Promise<R> => {
      // Support both with(ctx, value, fn) and with(value, fn)
      // SAFETY: a third argument means the second one is the value; without
      // it the first argument was the value. That is what the two declared
      // overloads say, and they are the only ways in.
      const value = (maybeFn ? valueOrFn : ctxOrValue) as Partial<T>;
      // SAFETY: whichever overload was used, the callback is the last argument.
      const fn = maybeFn || (valueOrFn as () => R | Promise<R>);

      // Serialize typed baggage to flat key-value pairs
      const prefix = namespace ? `${namespace}.` : '';
      const flatBaggage: Record<string, string> = {};
      for (const [key, val] of Object.entries(value)) {
        if (val !== undefined) {
          flatBaggage[`${prefix}${key}`] = String(val);
        }
      }

      return context.with(contextWithBaggage(flatBaggage), fn);
    },
  };
}

/**
 * Trace context types and utilities
 */

import type {
  AttributeValue as OtelAttributeValue,
  Attributes,
  Span,
  SpanStatusCode,
  BaggageEntry,
  Context,
  Link,
} from '@opentelemetry/api';
import { context, propagation } from '@opentelemetry/api';
// namespace import for browser-bundler compat; `import type` is erased — see node-require.ts
import type { AsyncLocalStorage } from 'node:async_hooks';
import * as nodeAsyncHooks from 'node:async_hooks';
import { recordStructuredError } from './structured-error';
import { track } from './track';
import type { UnknownRecord } from './values';
import { isFunction } from './values';

const spansWithExplicitStatus = new WeakSet<Span>();

/** Whether a TraceContext consumer explicitly chose this span's status. */
export function hasExplicitSpanStatus(span: Span): boolean {
  return spansWithExplicitStatus.has(span);
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
 * Get the active OTel context with the latest stored baggage overlaid.
 * Span identity always comes from the active OTel scope.
 */
export function getActiveContextWithBaggage(): Context {
  const activeContext = context.active();
  const stored = contextStorage.getStore()?.value;
  if (!stored) return activeContext;

  // The stored context exists to retain baggage updates, not span identity.
  // A nested operation can outlive the scope in which the store was last
  // updated, leaving its span in the stored context after OTel has restored
  // the parent as active. Overlaying only the baggage keeps propagation state
  // while ensuring callers always see the span from the current OTel scope.
  const storedBaggage = propagation.getBaggage(stored);
  return storedBaggage
    ? propagation.setBaggage(activeContext, storedBaggage)
    : activeContext;
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

function updateActiveContext(newContext: Context): void {
  // Update our storage first so any helper reads see the new context
  enterOrRun(contextStorage, newContext);

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
  /** Set a single attribute on the span */
  setAttribute(key: string, value: AttributeValue): void;
  /** Set multiple attributes on the span */
  setAttributes(attrs: Attributes): void;
  /** Set the status of the span */
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  /** Add a link to another span */
  addLink(link: Link): void;
  /** Add multiple links to other spans */
  addLinks(links: Link[]): void;
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
   * Emit a tracked event correlated to this span. Equivalent to the standalone
   * `track(event, data)` but reads naturally on `ctx`. Replaces the deprecated
   * `ctx.addEvent` (OTEP 4430) — events become correlated logs rather than
   * span events.
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

  // Store the current active context in AsyncLocalStorage so baggage setters can update it
  // This ensures ctx.setBaggage() changes persist and are visible to OpenTelemetry operations
  // IMPORTANT: Only initialize if not already set (preserve baggage updates from parent spans)
  const existingStored = contextStorage.getStore()?.value;
  if (!existingStored) {
    const activeContext = context.active();
    enterOrRun(contextStorage, activeContext);
  }

  // Baggage helpers that always use the current active context
  // This ensures baggage operations work correctly even if context changes
  const baggageHelpers: BaggageMethods<TBaggage> = {
    getBaggage(key: string): string | undefined {
      // Check active context first (from withBaggage, context.with, etc.)
      // Then check stored context (from setters)
      // This ensures both withBaggage() and ctx.setBaggage() work correctly
      const activeCtx = context.active();
      let baggage = propagation.getBaggage(activeCtx);
      if (!baggage) {
        const storedContext = contextStorage.getStore()?.value;
        if (storedContext) {
          baggage = propagation.getBaggage(storedContext);
        }
      }
      return baggage?.getEntry(key)?.value;
    },

    setBaggage(key: string, value: string): string {
      // OpenTelemetry contexts are immutable, so we create a new context with updated baggage
      // Merge stored baggage into the active context so updates never replace
      // the current span with a span retained by an ancestor's storage scope.
      const currentContext = getActiveContextWithBaggage();
      const baggage =
        propagation.getBaggage(currentContext) ?? propagation.createBaggage();
      const updated = baggage.setEntry(key, { value });
      const newContext = propagation.setBaggage(currentContext, updated);

      updateActiveContext(newContext);

      return value;
    },

    deleteBaggage(key: string): void {
      const currentContext = getActiveContextWithBaggage();
      const baggage = propagation.getBaggage(currentContext);
      if (baggage) {
        const updated = baggage.removeEntry(key);
        const newContext = propagation.setBaggage(currentContext, updated);

        updateActiveContext(newContext);
      }
    },

    getAllBaggage(): Map<string, BaggageEntry> {
      // Check active context first, then stored context
      const activeCtx = context.active();
      let baggage = propagation.getBaggage(activeCtx);
      if (!baggage) {
        const storedContext = contextStorage.getStore()?.value;
        if (storedContext) {
          baggage = propagation.getBaggage(storedContext);
        }
      }
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
      // Check active context first, then stored context
      const activeCtx = context.active();
      let baggage = propagation.getBaggage(activeCtx);
      if (!baggage) {
        const storedContext = contextStorage.getStore()?.value;
        if (storedContext) {
          baggage = propagation.getBaggage(storedContext);
        }
      }
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
      const currentContext = getActiveContextWithBaggage();
      let baggage =
        propagation.getBaggage(currentContext) ?? propagation.createBaggage();

      const prefix = namespace ? `${namespace}.` : '';
      for (const [key, val] of Object.entries(value)) {
        if (val !== undefined) {
          const baggageKey = `${prefix}${key}`;
          baggage = baggage.setEntry(baggageKey, { value: String(val) });
        }
      }

      const newContext = propagation.setBaggage(currentContext, baggage);
      updateActiveContext(newContext);
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
    setAttribute: span.setAttribute.bind(span),
    setAttributes: span.setAttributes.bind(span),
    setStatus: (status: { code: SpanStatusCode; message?: string }) => {
      spansWithExplicitStatus.add(span);
      span.setStatus(status);
    },
    recordException: span.recordException.bind(span),
    addEvent: span.addEvent.bind(span),
    addLink: span.addLink.bind(span),
    addLinks: span.addLinks.bind(span),
    updateName: span.updateName.bind(span),
    isRecording: span.isRecording.bind(span),
    recordError: (cause: unknown) => {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      recordStructuredError(traceCtx, err);
    },
    track: (event: string, data?: UnknownRecord) => {
      track(event, data);
    },
    ...baggageHelpers,
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

      // Use the existing withBaggage helper
      const currentContext = context.active();
      let baggage =
        propagation.getBaggage(currentContext) ?? propagation.createBaggage();

      for (const [key, val] of Object.entries(flatBaggage)) {
        baggage = baggage.setEntry(key, { value: val });
      }

      const newContext = propagation.setBaggage(currentContext, baggage);
      return context.with(newContext, fn);
    },
  };
}

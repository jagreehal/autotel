/**
 * Trace context types and utilities
 */

import type {
  Span,
  SpanStatusCode,
  BaggageEntry,
  Context,
  Link,
  TimeInput,
} from '@opentelemetry/api';
import { context, propagation } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage for storing the active context with baggage
 * This allows setters to update the context and have it persist
 */
const contextStorage = new AsyncLocalStorage<Context>();

/**
 * Get the context storage instance (for initialization in functional.ts)
 */
export function getContextStorage(): AsyncLocalStorage<Context> {
  return contextStorage;
}

/**
 * Get the active context, checking our stored context first
 * This ensures baggage setters work with OpenTelemetry's propagation
 */
export function getActiveContextWithBaggage(): Context {
  // Check stored context first (from setters), then fall back to active context
  // This ensures ctx.setBaggage() changes are visible to OpenTelemetry operations
  const stored = contextStorage.getStore();
  return stored ?? context.active();
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
  contextStorage.enterWith(newContext);

  const contextWithManager = context as unknown as {
    _getContextManager?: () => ContextManagerLike;
  };

  const manager = contextWithManager._getContextManager?.();
  if (!manager) return;

  const asyncLocal =
    (manager as { _asyncLocalStorage?: { enterWith?: (ctx: Context) => void } })
      ._asyncLocalStorage ?? undefined;
  if (asyncLocal?.enterWith) {
    asyncLocal.enterWith(newContext);
    return;
  }

  if (typeof manager.with === 'function') {
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
export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

/**
 * Span methods available on trace context
 */
export interface SpanMethods {
  /** Set a single attribute on the span */
  setAttribute(key: string, value: AttributeValue): void;
  /** Set multiple attributes on the span */
  setAttributes(attrs: Record<string, AttributeValue>): void;
  /** Set the status of the span */
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  /** Record an exception on the span */
  recordException(exception: Error, time?: TimeInput): void;
  /** Add an event to the span (for logging milestones/checkpoints) */
  addEvent(
    name: string,
    attributesOrStartTime?: Record<string, AttributeValue> | TimeInput,
    startTime?: TimeInput,
  ): void;
  /** Add a link to another span */
  addLink(link: Link): void;
  /** Add multiple links to other spans */
  addLinks(links: Link[]): void;
  /** Update the span name dynamically */
  updateName(name: string): void;
  /** Check if the span is recording */
  isRecording(): boolean;
}

/**
 * Baggage methods available on trace context
 *
 * @template TBaggage - Optional type for typed baggage (defaults to undefined for untyped)
 */
export interface BaggageMethods<
  TBaggage extends Record<string, unknown> | undefined = undefined,
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
  getTypedBaggage?: TBaggage extends Record<string, unknown>
    ? <T extends TBaggage>(namespace?: string) => Partial<T> | undefined
    : never;

  /**
   * Set typed baggage (only available when TBaggage is defined)
   * This is used internally by defineBaggageSchema()
   *
   * @internal
   */
  setTypedBaggage?: TBaggage extends Record<string, unknown>
    ? <T extends TBaggage>(
        namespace: string | undefined,
        value: Partial<T>,
      ) => void
    : never;
}

/**
 * Complete trace context that merges base context, span methods, and baggage methods
 *
 * This is the ctx parameter passed to factory functions in trace().
 * It provides access to trace IDs, span manipulation methods, and baggage operations.
 *
 * @template TBaggage - Optional type for typed baggage support
 *
 * @example Untyped (default)
 * ```typescript
 * export const handler = trace((ctx) => async () => {
 *   ctx.getBaggage('key'); // returns string | undefined
 * });
 * ```
 *
 * @example Typed baggage
 * ```typescript
 * type TenantBaggage = { tenantId: string; region?: string };
 *
 * export const handler = trace<TenantBaggage>((ctx) => async () => {
 *   // Use typed schema helper for type-safe access
 *   const schema = defineBaggageSchema<TenantBaggage>('tenant');
 *   const tenant = schema.get(ctx); // Partial<TenantBaggage> | undefined
 * });
 * ```
 */
export type TraceContext<
  TBaggage extends Record<string, unknown> | undefined = undefined,
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
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(span: Span): TraceContext<TBaggage> {
  const spanContext = span.spanContext();

  // Store the current active context in AsyncLocalStorage so baggage setters can update it
  // This ensures ctx.setBaggage() changes persist and are visible to OpenTelemetry operations
  // IMPORTANT: Only initialize if not already set (preserve baggage updates from parent spans)
  const existingStored = contextStorage.getStore();
  if (!existingStored) {
    const activeContext = context.active();
    contextStorage.enterWith(activeContext);
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
        const storedContext = contextStorage.getStore();
        if (storedContext) {
          baggage = propagation.getBaggage(storedContext);
        }
      }
      return baggage?.getEntry(key)?.value;
    },

    setBaggage(key: string, value: string): string {
      // OpenTelemetry contexts are immutable, so we create a new context with updated baggage
      // Check active context first (may have baggage from withBaggage), then stored context
      const activeCtx = context.active();
      const storedContext = contextStorage.getStore();
      const currentContext = storedContext ?? activeCtx;
      const baggage =
        propagation.getBaggage(currentContext) ?? propagation.createBaggage();
      const updated = baggage.setEntry(key, { value });
      const newContext = propagation.setBaggage(currentContext, updated);

      updateActiveContext(newContext);

      return value;
    },

    deleteBaggage(key: string): void {
      // Check active context first, then stored context
      const activeCtx = context.active();
      const storedContext = contextStorage.getStore();
      const currentContext = storedContext ?? activeCtx;
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
        const storedContext = contextStorage.getStore();
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
    getTypedBaggage: (<T extends Record<string, unknown>>(
      namespace?: string,
    ) => {
      // Check active context first, then stored context
      const activeCtx = context.active();
      let baggage = propagation.getBaggage(activeCtx);
      if (!baggage) {
        const storedContext = contextStorage.getStore();
        if (storedContext) {
          baggage = propagation.getBaggage(storedContext);
        }
      }
      if (!baggage) return;

      const prefix = namespace ? `${namespace}.` : '';
      const result: Record<string, unknown> = {};

      for (const [key, entry] of baggage.getAllEntries()) {
        if (namespace && key.startsWith(prefix)) {
          const fieldName = key.slice(prefix.length);
          result[fieldName] = entry.value;
        } else if (!namespace) {
          result[key] = entry.value;
        }
      }

      return Object.keys(result).length > 0
        ? (result as Partial<T>)
        : undefined;
    }) as TBaggage extends Record<string, unknown>
      ? <T extends TBaggage>(namespace?: string) => Partial<T> | undefined
      : never,

    setTypedBaggage: (<T extends Record<string, unknown>>(
      namespace: string | undefined,
      value: Partial<T>,
    ) => {
      // Check active context first, then stored context
      const activeCtx = context.active();
      const storedContext = contextStorage.getStore();
      const currentContext = storedContext ?? activeCtx;
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
    }) as TBaggage extends Record<string, unknown>
      ? <T extends TBaggage>(
          namespace: string | undefined,
          value: Partial<T>,
        ) => void
      : never,
  };

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    correlationId: spanContext.traceId.slice(0, 16),
    setAttribute: span.setAttribute.bind(span),
    setAttributes: span.setAttributes.bind(span),
    setStatus: span.setStatus.bind(span),
    recordException: span.recordException.bind(span),
    addEvent: span.addEvent.bind(span),
    addLink: span.addLink.bind(span),
    addLinks: span.addLinks.bind(span),
    updateName: span.updateName.bind(span),
    isRecording: span.isRecording.bind(span),
    ...baggageHelpers,
  };
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
export function defineBaggageSchema<T extends Record<string, unknown>>(
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
      const value = maybeFn
        ? (valueOrFn as Partial<T>)
        : (ctxOrValue as Partial<T>);
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

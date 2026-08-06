/**
 * Functional API for non-class code
 *
 * Three approaches for different use cases:
 * 1. trace() - Zero-ceremony HOF for single functions
 * 2. withTracing() - Middleware-style composable wrapper
 * 3. instrument() - Batch auto-instrumentation for modules
 *
 * @example trace() - Single function
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   getActiveTraceContext()?.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example withTracing() - Composable middleware
 * ```typescript
 * export const createUser = withTracing({
 *   name: 'user.create'
 * })(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example instrument() - Batch instrumentation
 * ```typescript
 * export default instrument({
 *   createUser: async (data) => { },
 *   updateUser: async (id, data) => { }
 * }, { serviceName: 'user' })
 * ```
 */

import {
  SpanStatusCode,
  trace as otelTrace,
  context,
  propagation,
  type Span,
} from '@opentelemetry/api';
import { getConfig } from './config';
import type { TraceContext } from './trace-context';
import {
  createTraceContext,
  getActiveContextWithBaggage,
  getContextStorage,
} from './trace-context';
import { runInOperationContext } from './operation-context';
import {
  FUNCTIONAL_ERROR_MESSAGE_LIMIT,
  wrapFactoryWithTracing,
  wrapPlainWithTracing,
  type AnyInstrumentable,
  type InstrumentOptions,
  type SingleInstrumentOptions,
  type TracingOptions,
  type WrappedFunction,
} from './functional-wrapper';

/**
 * Complete trace context containing trace identifiers and span methods
 *
 * The ctx parameter in trace() functions provides:
 * - traceId, spanId, correlationId from the active span
 * - Span manipulation methods (setAttribute, setAttributes, setStatus, recordException)
 *
 * For custom context, access it directly in your functions (standard OpenTelemetry pattern).
 *
 * @example
 * ```typescript
 * import { trace } from 'autotel'
 *
 * export const createUser = withTracing({})((ctx) => async (data: CreateUserData) => {
 *   // Get custom context directly (standard OTel approach)
 *   const userId = getCurrentUserId()
 *   const tenantId = getCurrentTenant()
 *
 *   // Use ctx for span operations and trace IDs
 *   ctx.setAttribute('user.id', data.id)
 *   ctx.setAttribute('user.tenant', tenantId)
 *   console.log(ctx.traceId)  // Trace IDs available
 * })
 * ```
 */
export type { TraceContext } from './trace-context';
export type {
  InstrumentOptions,
  SingleInstrumentOptions,
  TracingOptions,
} from './functional-wrapper';

function shouldSkip(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  fn: Function,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  skip?: (string | RegExp | ((key: string, fn: Function) => boolean))[],
): boolean {
  // Default: skip functions starting with _
  if (key.startsWith('_')) {
    return true;
  }

  if (!skip || skip.length === 0) {
    return false;
  }

  for (const rule of skip) {
    if (typeof rule === 'string' && key === rule) {
      return true;
    } else if (rule instanceof RegExp && rule.test(key)) {
      return true;
    } else if (typeof rule === 'function' && rule(key, fn)) {
      return true;
    }
  }

  return false;
}

/**
 * Get current trace context value (internal helper)
 *
 * Returns base context (trace IDs) + span methods from the active span.
 */
function getCtxValue<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> | null {
  const activeSpan = otelTrace.getActiveSpan();
  if (!activeSpan) return null;

  // Use shared utility to create trace context
  return createTraceContext<TBaggage>(activeSpan);
}

/**
 * Get the autotel {@link TraceContext} for the currently active span.
 *
 * This is the ambient accessor for the functional API: instead of threading a
 * `ctx` parameter through a factory, call this inside any traced function (or a
 * helper it calls) to reach `setAttribute`, `setUser`, `getBaggage`, and the
 * rest of the context surface. Returns `undefined` when no span is active.
 *
 * @example
 * ```typescript
 * const getUser = trace('getUser', async (id: string) => {
 *   getActiveTraceContext()?.setAttribute('user.id', id);
 *   return db.users.find(id);
 * });
 * ```
 *
 * @see getActiveSpan for the raw OpenTelemetry span
 * @see getRequestLogger which reads the active context when called with no args
 */
export function getActiveTraceContext<
  TBaggage extends Record<string, unknown> | undefined = undefined,
>(): TraceContext<TBaggage> | undefined {
  return getCtxValue<TBaggage>() ?? undefined;
}

/**
 * Context object that lazily evaluates the active span on property access
 *
 * Access trace context directly without function call syntax.
 *
 * @example
 * ```typescript
 * import { trace, ctx } from 'autotel'
 *
 * export const createUser = trace(async (data) => {
 *   // Direct property access - no function call!
 *   if (ctx.traceId) {
 *     ctx.setAttribute('user.id', data.id)
 *     console.log('Trace:', ctx.traceId)
 *   }
 * })
 * ```
 */
export const ctx = new Proxy({} as TraceContext, {
  get(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return;
    }
    return ctxValue[prop as keyof typeof ctxValue];
  },

  has(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return false;
    }
    return prop in ctxValue;
  },

  ownKeys() {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return [];
    }
    return Object.keys(ctxValue);
  },

  getOwnPropertyDescriptor(_target, prop) {
    const ctxValue = getCtxValue();
    if (!ctxValue) {
      return;
    }
    return Object.getOwnPropertyDescriptor(ctxValue, prop);
  },
});

/**
 * Wrap a plain function with automatic tracing. The function receives its real
 * arguments; no context parameter is injected. Use
 * {@link getActiveTraceContext} inside the function, or use {@link withTracing}
 * for the explicit `(ctx) => (...args) => result` factory form.
 *
 * `trace()` never executes or inspects the function during wrapper
 * construction.
 *
 * @example Auto-inferred name
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Ambient context access
 * ```typescript
 * export const createUser = trace(async (data) => {
 *   getActiveTraceContext()?.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Explicit name
 * ```typescript
 * export const createUser = trace('user.create', async (data) => {
 *   return await db.users.create(data)
 * })
 * ```
 */
// trace(fn)
export function trace<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(name, fn)
export function trace<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// trace(options, fn)
export function trace<TArgs extends unknown[], TReturn>(
  options: TracingOptions<TArgs, TReturn>,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn;
// Implementation
export function trace<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  fnOrNameOrOptions:
    | ((...args: TArgs) => TReturn)
    | ((...args: TArgs) => Promise<TReturn>)
    | string
    | TracingOptions<TArgs, TReturn>,
  maybeFn?:
    ((...args: TArgs) => TReturn) | ((...args: TArgs) => Promise<TReturn>),
): WrappedFunction<TArgs, TReturn> {
  // trace(fn) - the function is plain; it receives its real arguments and no
  // context is injected. Reach the active span via getActiveTraceContext().
  if (typeof fnOrNameOrOptions === 'function') {
    return wrapPlainWithTracing(
      fnOrNameOrOptions as (...args: TArgs) => TReturn,
      {} as TracingOptions<TArgs, TReturn>,
    );
  }

  // trace(name, fn) or trace(options, fn)
  if (!maybeFn) {
    throw new Error('trace(name|options, fn): fn is required');
  }

  const options: TracingOptions<TArgs, TReturn> =
    typeof fnOrNameOrOptions === 'string'
      ? ({ name: fnOrNameOrOptions } as TracingOptions<TArgs, TReturn>)
      : fnOrNameOrOptions;

  return wrapPlainWithTracing(maybeFn as (...args: TArgs) => TReturn, options);
}

/**
 * Approach 2: withTracing() - Middleware-style composable wrapper
 *
 * Returns a HOF that wraps functions with tracing.
 * Perfect for composition and reusable configuration.
 *
 * @example Standard usage
 * ```typescript
 * export const createUser = withTracing({
 *   name: 'user.create'
 * })(ctx => async (data) => {
 *   ctx.setAttribute('user.id', data.id)
 *   return await db.users.create(data)
 * })
 * ```
 *
 * @example Composable
 * ```typescript
 * const tracer = withTracing({ serviceName: 'user' })
 *
 * export const createUser = tracer(ctx => async (data) => { })
 * export const updateUser = tracer(ctx => async (id, data) => { })
 * ```
 *
 * @example With other middleware
 * ```typescript
 * export const createUser = compose(
 *   withAuth({ role: 'admin' }),
 *   withTracing({ name: 'user.create' }),
 *   withRateLimit({ max: 100 })
 * )(ctx => async (data) => { })
 * ```
 */
export function withTracing<
  TCfgArgs extends unknown[] = unknown[],
  TCfgReturn = unknown,
>(options: TracingOptions<TCfgArgs, TCfgReturn> = {}) {
  return <TArgs extends TCfgArgs, TReturn extends TCfgReturn>(
    fnFactory: (
      ctx: TraceContext,
    ) => (...args: TArgs) => TReturn | Promise<TReturn>,
  ): WrappedFunction<TArgs, TReturn> =>
    wrapFactoryWithTracing<TArgs, TReturn>(fnFactory, options);
}

/**
 * Approach 3: instrument() - Batch auto-instrumentation
 *
 * Instrument an entire module/object at once.
 * Closest to @Instrumented decorator pattern.
 *
 * @example Basic usage
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     updateUser: async (id, data) => { },
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   sampler: new AdaptiveSampler()
 * })
 * // → Traced as "user.createUser", "user.updateUser", "user.deleteUser"
 * ```
 *
 * @example Per-function overrides
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   overrides: {
 *     deleteUser: {
 *       sampler: new AlwaysSampler(),
 *       withMetrics: true
 *     }
 *   }
 * })
 * ```
 *
 * @example Skip functions
 * ```typescript
 * export default instrument({
 *   functions: {
 *     createUser: async (data) => { },
 *     _internal: async () => { }, // Auto-skipped (_-prefix)
 *     deleteUser: async (id) => { }
 *   },
 *   serviceName: 'user',
 *   skip: [/^test/, (key) => key.includes('debug')]
 * })
 * ```
 */
export function instrument<TFunction extends AnyInstrumentable>(
  options: SingleInstrumentOptions<TFunction>,
): TFunction;
export function instrument<T extends Record<string, AnyInstrumentable>>(
  options: InstrumentOptions<T>,
): T;
export function instrument<
  T extends Record<string, AnyInstrumentable>,
  TFunction extends AnyInstrumentable,
>(
  options: InstrumentOptions<T> | SingleInstrumentOptions<TFunction>,
): T | TFunction {
  if (!options || typeof options !== 'object') {
    throw new TypeError(
      'instrument: expected { key, fn } or { functions: { name: fn } }',
    );
  }

  if ('key' in options || 'fn' in options) {
    const { key, fn, ...tracingOptions } =
      options as SingleInstrumentOptions<TFunction>;
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError(
        'instrument: "key" must be a non-empty string in the { key, fn } form',
      );
    }
    if (typeof fn !== 'function') {
      throw new TypeError(
        'instrument: "fn" must be a function in the { key, fn } form',
      );
    }
    return wrapPlainWithTracing(fn, tracingOptions, key) as TFunction;
  }

  const { functions, ...tracingOptions } = options as InstrumentOptions<T>;
  if (!functions || typeof functions !== 'object') {
    throw new TypeError(
      'instrument: expected { key, fn } or { functions: { name: fn } }',
    );
  }
  const instrumented: Partial<T> = {};

  for (const key of Object.keys(functions)) {
    const typedKey = key as keyof T;
    const fn = functions[typedKey];

    // Skip if not a function or undefined - just pass through the value
    if (!fn || typeof fn !== 'function') {
      instrumented[typedKey] = fn as T[typeof typedKey];
      continue;
    }

    // Only instrument own enumerable async functions
    // Check if should skip
    if (shouldSkip(key, fn, tracingOptions.skip)) {
      instrumented[typedKey] = fn as T[typeof typedKey];
      continue;
    }

    // Merge base options with per-function overrides
    const fnOptions: TracingOptions = {
      ...tracingOptions,
      ...tracingOptions.overrides?.[key],
      // If no explicit name, use key as function name
      name: tracingOptions.overrides?.[key]?.name,
    };

    // Bind function to original object to preserve 'this' context
    // This ensures methods can access state on the original object
    const boundFn = fn.bind(functions);

    // Convert plain function to factory pattern for trace()
    // For instrument(), we create a factory that ignores ctx and returns the original function
    const fnFactory = (ctx: TraceContext) => {
      void ctx;
      return boundFn;
    };

    // Wrap with tracing (sync or async based on implementation)
    instrumented[typedKey] = wrapFactoryWithTracing(
      fnFactory,
      fnOptions,
      key,
    ) as unknown as T[typeof typedKey];
  }

  return instrumented as T;
}

/**
 * Options for span() function
 */
export interface SpanOptions {
  /** Span name */
  name: string;
  /** Attributes to set on the span */
  attributes?: Record<string, string | number | boolean>;
  /** OpenTelemetry span kind */
  spanKind?: import('@opentelemetry/api').SpanKind;
}

/**
 * Execute a function within a named span
 *
 * Useful for adding tracing to specific code blocks without wrapping
 * the entire function. Supports both synchronous and asynchronous functions.
 *
 * Mirrors `trace()`: pass a span name as the first argument for the common
 * case, or full `SpanOptions` when you need to attach attributes.
 *
 * @example
 * ```typescript
 * // Name shorthand
 * await span('payment.charge', async (span) => {
 *   await chargeCustomer(order);
 * })
 *
 * // Full options when attributes are needed
 * await span(
 *   { name: 'payment.charge', attributes: { amount: order.total } },
 *   async (span) => {
 *     await chargeCustomer(order);
 *   },
 * )
 *
 * // Sync
 * const total = span('calculateTotal', (span) => {
 *   return items.reduce((sum, item) => sum + item.price, 0);
 * })
 * ```
 */
// Overloads — sync first (more specific match), then async.
// Each shape is offered with a string name OR a full SpanOptions object so
// span() aligns with trace()'s argument flexibility.
export function span<T = unknown>(name: string, fn: (span: Span) => T): T;
export function span<T = unknown>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => T,
): T;
export function span<T = unknown>(
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T>;
// Implementation
export function span<T = unknown>(
  nameOrOptions: string | SpanOptions,
  fn: (span: Span) => T | Promise<T>,
): T | Promise<T> {
  const options: SpanOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const config = getConfig();
  const tracer = config.tracer;
  const { name, attributes, spanKind } = options;

  const executeSpan = (span: Span) => {
    // Run within operation context so events can auto-capture operation.name
    return runInOperationContext(name, () => {
      try {
        // Set attributes
        if (attributes) {
          for (const [key, value] of Object.entries(attributes)) {
            span.setAttribute(key, value);
          }
        }

        const result = fn(span);

        // Check if result is a Promise
        if (result instanceof Promise) {
          return result
            .then((resolved) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return resolved;
            })
            .catch((error) => {
              const errorMessage =
                error instanceof Error
                  ? error.message.slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT)
                  : String(error).slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT);

              span.setAttribute('error.message', errorMessage);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: errorMessage,
              });

              span.recordException(
                error instanceof Error ? error : new Error(String(error)),
              );
              span.end();
              throw error;
            });
        } else {
          // Synchronous function
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        }
      } catch (error) {
        // Synchronous error handling
        const errorMessage =
          error instanceof Error
            ? error.message.slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT)
            : String(error).slice(0, FUNCTIONAL_ERROR_MESSAGE_LIMIT);

        span.setAttribute('error.message', errorMessage);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage,
        });

        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.end();
        throw error;
      }
    });
  };

  const parentContext = getActiveContextWithBaggage();
  const result = tracer.startActiveSpan(
    name,
    spanKind === undefined ? {} : { kind: spanKind },
    parentContext,
    executeSpan,
  );

  // tracer.startActiveSpan might return a Promise even for sync callbacks
  // Check if it's a Promise and handle accordingly
  if (result instanceof Promise) {
    return result;
  }

  return result as T;
}

/**
 * Options for withNewContext() function
 */
export interface WithNewContextOptions<T = unknown> {
  /** Function to execute in new root context */
  fn: () => Promise<T>;
}

/**
 * Execute a function in a new root context (prevents span propagation)
 *
 * Useful when you want to start a completely new trace without
 * parent-child relationships.
 *
 * @example
 * ```typescript
 * async function handleWebhook(payload: WebhookPayload) {
 *   // This creates a new root trace, not connected to the HTTP request trace
 *   await withNewContext({
 *     fn: async () => {
 *       await span('webhook.process', async () => {
 *         await processWebhookPayload(payload)
 *       })
 *     }
 *   })
 * }
 * ```
 */
export async function withNewContext<T = unknown>(
  options: WithNewContextOptions<T>,
): Promise<T> {
  const { fn } = options;
  const config = getConfig();
  const tracer = config.tracer;

  // Start a new root span (breaks trace propagation)
  return tracer.startActiveSpan('root', { root: true }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Options for withBaggage() function
 */
export interface WithBaggageOptions<T = unknown> {
  /** Baggage entries to set (key-value pairs) */
  baggage: Record<string, string>;
  /** Function to execute with the updated baggage */
  fn: () => T | Promise<T>;
}

/**
 * Execute a function with updated baggage entries
 *
 * Baggage is immutable in OpenTelemetry, so this helper creates a new context
 * with the specified baggage entries and runs the function within that context.
 * All child spans created within the function will inherit the baggage.
 *
 * @example Setting baggage for downstream services
 * ```typescript
 * import { withTracing, withBaggage } from 'autotel';
 *
 * export const createOrder = withTracing({ name: 'order.create' })((ctx) => async (order: Order) => {
 *   // Set baggage that will be propagated to downstream HTTP calls
 *   return await withBaggage({
 *     baggage: {
 *       'tenant.id': order.tenantId,
 *       'user.id': order.userId,
 *     },
 *     fn: async () => {
 *       // This HTTP call will include the baggage in headers
 *       await fetch('/api/charge', {
 *         method: 'POST',
 *         body: JSON.stringify(order),
 *       });
 *     },
 *   });
 * });
 * ```
 *
 * @example Using with existing baggage
 * ```typescript
 * export const processOrder = withTracing({ name: 'order.process' })((ctx) => async (order: Order) => {
 *   // Read existing baggage
 *   const tenantId = ctx.getBaggage('tenant.id');
 *
 *   // Add additional baggage entries
 *   return await withBaggage({
 *     baggage: {
 *       'order.id': order.id,
 *       'order.amount': String(order.amount),
 *     },
 *     fn: async () => {
 *       await charge(order);
 *     },
 *   });
 * });
 * ```
 */
export function withBaggage<T = unknown>(
  options: WithBaggageOptions<T>,
): T | Promise<T> {
  const { baggage: baggageEntries, fn } = options;
  const currentContext = context.active();

  // Get existing baggage or create new
  let updatedBaggage =
    propagation.getBaggage(currentContext) ?? propagation.createBaggage();

  // Set all baggage entries
  for (const [key, value] of Object.entries(baggageEntries)) {
    updatedBaggage = updatedBaggage.setEntry(key, { value });
  }

  // Create new context with updated baggage
  const newContext = propagation.setBaggage(currentContext, updatedBaggage);

  // Sync contextStorage so nested traces (via getActiveContextWithBaggage) see the baggage.
  // Use run() instead of enterWith() to properly scope the context changes.
  const ctxStorage = getContextStorage();
  const previousStored = ctxStorage.getStore();
  const baggageEnrichedStored = previousStored
    ? { value: propagation.setBaggage(previousStored.value, updatedBaggage) }
    : { value: newContext };

  // Run the function within the new context, scoped properly
  const result = previousStored
    ? ctxStorage.run(baggageEnrichedStored, () => context.with(newContext, fn))
    : context.with(newContext, fn);

  if (result instanceof Promise) {
    // For async operations, ensure context is restored after the promise settles
    return result.then(
      (value) => {
        // Restore original context before resolving
        if (previousStored) {
          return ctxStorage.run(previousStored, () => value);
        }
        return value;
      },
      (error) => {
        // Restore original context before rejecting
        if (previousStored) {
          return ctxStorage.run(previousStored, () => {
            throw error;
          });
        }
        throw error;
      },
    );
  }

  // Sync function - context automatically restored when scope exits
  return result;
}

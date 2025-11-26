/**
 * TypeScript 5+ Decorators for autotel
 *
 * Provides @Trace decorator for class-based code.
 *
 * **Requires TypeScript 5.0+**
 *
 * @example Method decorator
 * ```typescript
 * import { Trace } from 'autotel/decorators'
 *
 * class OrderService {
 *   @Trace('order.create', { withMetrics: true })
 *   async createOrder(data: OrderData) {
 *     return await db.orders.create(data)
 *   }
 *
 *   @Trace() // Uses method name as span name
 *   async processPayment(orderId: string) {
 *     return await stripe.charge(orderId)
 *   }
 * }
 * ```
 */

import type { TracingOptions, TraceContext } from './functional';
import { getConfig } from './config';
import { SpanStatusCode } from '@opentelemetry/api';
import { createTraceContext } from './trace-context';

/**
 * Options for @Trace method decorator
 */
export interface TraceDecoratorOptions extends Omit<TracingOptions, 'name'> {
  /**
   * Custom span name. If not provided, uses the method name.
   */
  name?: string;
}

/**
 * @Trace - Method decorator for fine-grained tracing
 *
 * Wraps a class method with automatic tracing. Supports both patterns:
 * - Simple: method doesn't use ctx
 * - Advanced: method accesses ctx via this.ctx
 *
 * @example Simple usage (no ctx)
 * ```typescript
 * class OrderService {
 *   @Trace()
 *   async createOrder(data: OrderData) {
 *     return await db.orders.create(data)
 *   }
 * }
 * ```
 *
 * @example With custom name and options
 * ```typescript
 * class PaymentService {
 *   @Trace('payment.charge', { withMetrics: true })
 *   async chargeCard(amount: number) {
 *     return await stripe.charges.create({ amount })
 *   }
 * }
 * ```
 *
 * @example Accessing ctx
 * ```typescript
 * interface WithTraceContext {
 *   ctx?: TraceContext
 * }
 *
 * class UserService {
 *   @Trace()
 *   async createUser(data: UserData) {
 *     // Access ctx via this.ctx (available during execution)
 *     const ctx = (this as unknown as WithTraceContext).ctx
 *     if (ctx) {
 *       ctx.setAttribute('user.id', data.id)
 *     }
 *     return await db.users.create(data)
 *   }
 * }
 * ```
 */
export function Trace(
  options?: TraceDecoratorOptions,
): <T extends (...args: unknown[]) => Promise<unknown>>(
  originalMethod: T,
  context: ClassMethodDecoratorContext,
) => T;
export function Trace(
  name?: string,
  options?: TraceDecoratorOptions,
): <T extends (...args: unknown[]) => Promise<unknown>>(
  originalMethod: T,
  context: ClassMethodDecoratorContext,
) => T;
export function Trace(
  nameOrOptions?: string | TraceDecoratorOptions,
  maybeOptions?: TraceDecoratorOptions,
): <T extends (...args: unknown[]) => Promise<unknown>>(
  originalMethod: T,
  context: ClassMethodDecoratorContext,
) => T {
  // Parse arguments
  const name =
    typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name;
  // Options are used in the returned decorator function, not here
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _options: TraceDecoratorOptions =
    typeof nameOrOptions === 'string'
      ? maybeOptions || {}
      : nameOrOptions || {};

  // TypeScript 5+ decorator signature
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    originalMethod: T,
    context: ClassMethodDecoratorContext,
  ): T {
    const methodName = String(context.name);

    // Skip if not an async function
    // Check multiple ways to detect async functions (for different transpilation environments)
    // TypeScript decorators run at class definition time, so we need robust detection
    const methodStr = originalMethod?.toString() || '';
    const isAsync =
      originalMethod &&
      (originalMethod.constructor?.name === 'AsyncFunction' ||
        methodStr.trim().startsWith('async ') ||
        (methodStr.includes('[native code]') && methodStr.includes('async')) ||
        // Fallback: if function has async in its string representation
        /async\s+/.test(methodStr));

    if (!isAsync) {
      // Not an async function, return as-is
      return originalMethod;
    }

    const spanName = name || methodName;

    return async function <This>(
      this: This,
      ...args: unknown[]
    ): Promise<unknown> {
      const config = getConfig();
      const tracer = config.tracer;

      return tracer.startActiveSpan(spanName, async (span) => {
        try {
          // Make ctx available via this.ctx for methods that need it
          const ctx: TraceContext = createTraceContext(span);

          const originalCtx = (this as { ctx?: TraceContext }).ctx;
          try {
            (this as { ctx?: TraceContext }).ctx = ctx;
            const result = await originalMethod.apply(this, args as []);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } finally {
            // Restore original ctx
            if (originalCtx === undefined) {
              delete (this as { ctx?: TraceContext }).ctx;
            } else {
              (this as { ctx?: TraceContext }).ctx = originalCtx;
            }
          }
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        } finally {
          span.end();
        }
      });
    } as T;
  };
}

// Re-export types for convenience

export { type TraceContext, type TracingOptions } from './functional';

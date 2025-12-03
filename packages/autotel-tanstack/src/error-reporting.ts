/**
 * Error reporting utilities for TanStack Start
 *
 * Provides basic error reporting without external dependencies,
 * following the patterns from TanStack Start observability guide.
 */

/**
 * Error report data structure
 */
export interface ErrorReport {
  id: string;
  count: number;
  lastSeen: Date;
  error: {
    name: string;
    message: string;
    stack?: string;
    context?: unknown;
  };
}

/**
 * Error store for in-memory error tracking
 *
 * Stores error reports with deduplication by error name + message.
 * Thread-safe for concurrent access.
 */
class ErrorStore {
  private errors = new Map<string, ErrorReport>();
  private readonly maxErrors = 100; // Limit memory usage

  /**
   * Report an error
   */
  reportError(error: Error, context?: unknown): string {
    const key = `${error.name}:${error.message}`;
    const existing = this.errors.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = new Date();
      if (context) {
        // Merge context
        existing.error.context = {
          ...(existing.error.context as Record<string, unknown>),
          ...(context as Record<string, unknown>),
        };
      }
      return key;
    }

    // Add new error
    const report: ErrorReport = {
      id: key,
      count: 1,
      lastSeen: new Date(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        context,
      },
    };

    this.errors.set(key, report);

    // Limit stored errors
    if (this.errors.size > this.maxErrors) {
      // Remove oldest error
      const entries = [...this.errors.entries()];
      const oldest = entries.toSorted(
        (a: [string, ErrorReport], b: [string, ErrorReport]) =>
          a[1].lastSeen.getTime() - b[1].lastSeen.getTime(),
      )[0];
      this.errors.delete(oldest[0]);
    }

    // Log immediately
    console.error('[ERROR REPORTED]:', {
      error: error.message,
      count: 1,
      context,
    });

    return key;
  }

  /**
   * Get all error reports
   */
  getAllErrors(): ErrorReport[] {
    return [...this.errors.values()];
  }

  /**
   * Get a specific error by ID
   */
  getError(id: string): ErrorReport | undefined {
    return this.errors.get(id);
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors.clear();
  }

  /**
   * Clear a specific error
   */
  clearError(id: string): void {
    this.errors.delete(id);
  }
}

/**
 * Global error store instance
 */
export const errorStore = new ErrorStore();

/**
 * Report an error to the error store
 *
 * @example
 * ```typescript
 * import { reportError } from 'autotel-tanstack/error-reporting';
 *
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   reportError(error as Error, {
 *     userId: context.userId,
 *     operation: 'riskyOperation',
 *   });
 *   throw error;
 * }
 * ```
 */
export function reportError(error: Error, context?: unknown): string {
  return errorStore.reportError(error, context);
}

/**
 * Create an error reporting endpoint handler
 *
 * Returns a handler that exposes error reports in JSON format.
 * Use this to create an `/admin/errors` endpoint.
 *
 * @example
 * ```typescript
 * // routes/admin/errors.ts
 * import { createFileRoute } from '@tanstack/react-router';
 * import { json } from '@tanstack/react-start';
 * import { createErrorReportingHandler } from 'autotel-tanstack/error-reporting';
 *
 * export const Route = createFileRoute('/admin/errors')({
 *   server: {
 *     handlers: {
 *       GET: createErrorReportingHandler(),
 *     },
 *   },
 * });
 * ```
 */
export function createErrorReportingHandler() {
  return async () => {
    const { json } = await import('@tanstack/react-start');

    return json({
      errors: errorStore.getAllErrors(),
    });
  };
}

/**
 * Wrap a function with automatic error reporting
 *
 * Automatically reports errors to the error store.
 *
 * @example
 * ```typescript
 * import { withErrorReporting } from 'autotel-tanstack/error-reporting';
 *
 * const riskyOperation = createServerFn()
 *   .handler(withErrorReporting(async () => {
 *     return await performOperation();
 *   }, { operation: 'riskyOperation' }));
 * ```
 */
export function withErrorReporting<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  context?: Record<string, unknown>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (error) {
      reportError(error as Error, context);
      throw error;
    }
  };
}

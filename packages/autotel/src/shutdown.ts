/**
 * Graceful shutdown with flush and cleanup
 */

import { getSdk, getLogger, _closeEmbeddedDevtools } from './init';
import { getEventQueue, resetEventQueue } from './track';
import { resetEvents } from './event';
import { resetMetrics } from './metric';
import { getForceFlushableProvider } from './tracer-provider';
import { uninstallProcessHandlers } from './process-handlers';

/**
 * Error codes that mean "the OTLP endpoint wasn't reachable" — expected and
 * harmless when no collector is configured. Deliberately limited to
 * connection-establishment failures (refused / DNS), not post-connection
 * errors like ECONNRESET or ETIMEDOUT, which can indicate a real problem
 * talking to a configured backend and should surface.
 */
const UNREACHABLE_ENDPOINT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * True when the error (or every error it wraps) is an unreachable-endpoint
 * failure. Traverses `AggregateError.errors` and the `cause` chain, since the
 * SDK often wraps the underlying network error.
 */
function isUnreachableEndpointError(error: unknown, depth = 0): boolean {
  if (depth > 5 || error === null || typeof error !== 'object') return false;

  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 &&
      error.errors.every((e) => isUnreachableEndpointError(e, depth + 1))
    );
  }

  const code = errorCode(error);
  if (code && UNREACHABLE_ENDPOINT_CODES.has(code)) return true;

  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error
    ? isUnreachableEndpointError(cause, depth + 1)
    : false;
}

/**
 * Flush all pending telemetry
 *
 * Flushes both events events and OpenTelemetry spans to their destinations.
 * Includes timeout protection to prevent hanging in serverless environments.
 *
 * Safe to call multiple times.
 *
 * @param options - Optional configuration
 * @param options.timeout - Timeout in milliseconds (default: 2000ms)
 * @param options.forShutdown - If true, permanently disables the events queue after flush (used internally by shutdown())
 *
 * @example Manual flush in serverless
 * ```typescript
 * import { flush } from 'autotel';
 *
 * export const handler = async (event) => {
 *   // ... process event
 *   await flush(); // Flush before function returns
 *   return result;
 * };
 * ```
 *
 * @example With custom timeout
 * ```typescript
 * await flush({ timeout: 5000 }); // 5 second timeout
 * ```
 */
export async function flush(options?: {
  timeout?: number;
  forShutdown?: boolean;
}): Promise<void> {
  const timeout = options?.timeout ?? 2000;
  const forShutdown = options?.forShutdown ?? false;

  const doFlush = async () => {
    // Flush events queue (or shutdown queue when tearing down)
    const eventsQueue = getEventQueue();
    if (eventsQueue) {
      await (forShutdown ? eventsQueue.shutdown() : eventsQueue.flush());
    }

    // Flush OpenTelemetry spans
    // This ensures spans are exported immediately, critical for serverless.
    // NodeSDK.getTracerProvider() returns undefined on sdk-node 0.220+, so
    // resolve a force-flushable provider from the global registry too.
    try {
      const tracerProvider = getForceFlushableProvider(getSdk());
      if (tracerProvider) {
        await tracerProvider.forceFlush();
      }
    } catch {
      // Ignore errors when accessing tracer provider (may not be available in test mocks)
    }
  };

  // Add timeout protection to prevent hanging
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      doFlush().finally(() => {
        // Clear timeout as soon as flush completes
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }),
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Flush timeout')),
          timeout,
        );
        // Use unref() to allow Node to exit if flush completes first
        // This prevents the 2s delay in serverless when flush succeeds immediately
        timeoutHandle.unref();
      }),
    ]);
  } catch (error) {
    // Clear timeout on error too
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    const logger = getLogger();
    logger.error(
      {
        err: error instanceof Error ? error : new Error(String(error)),
      },
      '[autotel] Flush error',
    );
    throw error;
  }
}

/**
 * Shutdown telemetry and cleanup resources
 *
 * - Flushes all pending data
 * - Shuts down OpenTelemetry SDK
 * - Cleans up resources
 *
 * Call this before process exit.
 *
 * Always performs cleanup even if flush fails, preventing resource leaks
 * in serverless handlers or tests.
 *
 * @example Express server
 * ```typescript
 * const server = app.listen(3000)
 *
 * process.on('SIGTERM', async () => {
 *   await server.close()
 *   await shutdown()
 *   process.exit(0)
 * })
 * ```
 */
export async function shutdown(): Promise<void> {
  const logger = getLogger();
  let shutdownError: Error | null = null;

  // Attempt to flush (with queue shutdown so new events are rejected), but continue with cleanup even if it fails
  try {
    await flush({ forShutdown: true });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    shutdownError = err;
    logger.error(
      {
        err,
      },
      '[autotel] Flush failed during shutdown, continuing cleanup',
    );
  }

  // Always shutdown SDK and clean up resources
  try {
    // Shutdown OpenTelemetry SDK
    const sdk = getSdk();
    if (sdk) {
      await sdk.shutdown();
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Ignore unreachable-endpoint errors - this happens when no OTLP endpoint
    // was configured. The SDK tries to flush exporters that can't connect,
    // which is harmless. Checks the cause chain / AggregateError too, since the
    // SDK usually wraps the underlying network error.
    if (!isUnreachableEndpointError(error)) {
      // Only store/log real shutdown errors
      if (!shutdownError) {
        shutdownError = err;
      }
      logger.error({ err }, '[autotel] SDK shutdown failed');
    }
  } finally {
    uninstallProcessHandlers();
    await _closeEmbeddedDevtools();

    // Clean up singleton Maps and queues to prevent memory leaks
    // This runs even if SDK shutdown fails
    const eventsQueue = getEventQueue();
    if (eventsQueue && typeof eventsQueue.cleanup === 'function') {
      eventsQueue.cleanup();
    }
    resetEvents();
    resetMetrics();
    resetEventQueue();
  }

  // Rethrow first error after cleanup completes
  // This allows tests and CI to detect failures while still ensuring cleanup
  if (shutdownError) {
    throw shutdownError;
  }
}

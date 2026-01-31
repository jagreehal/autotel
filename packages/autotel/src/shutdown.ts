/**
 * Graceful shutdown with flush and cleanup
 */

import { getSdk, getLogger } from './init';
import { getEventQueue, resetEventQueue } from './track';
import { resetEvents } from './event';
import { resetMetrics } from './metric';

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
      if (forShutdown) {
        await eventsQueue.shutdown();
      } else {
        await eventsQueue.flush();
      }
    }

    // Flush OpenTelemetry spans
    // This ensures spans are exported immediately, critical for serverless
    const sdk = getSdk();
    if (sdk) {
      try {
        // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdkAny = sdk as any;
        if (typeof sdkAny.getTracerProvider === 'function') {
          const tracerProvider = sdkAny.getTracerProvider();
          if (
            tracerProvider &&
            typeof tracerProvider.forceFlush === 'function'
          ) {
            await tracerProvider.forceFlush();
          }
        }
      } catch {
        // Ignore errors when accessing tracer provider (may not be available in test mocks)
      }
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

    // Ignore ECONNREFUSED errors - this happens when no OTLP endpoint was configured
    // The SDK tries to flush exporters that don't exist, which is harmless
    const isConnectionRefused =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ECONNREFUSED';

    if (!isConnectionRefused) {
      // Only store/log non-connection errors
      if (!shutdownError) {
        shutdownError = err;
      }
      logger.error({ err }, '[autotel] SDK shutdown failed');
    }
  } finally {
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

/**
 * Register automatic shutdown hooks for common signals
 *
 * Handles:
 * - SIGTERM (Docker/K8s graceful shutdown)
 * - SIGINT (Ctrl+C)
 *
 * @internal Called automatically on module load
 */
function registerShutdownHooks(): void {
  if (typeof process === 'undefined') return; // Not in Node.js

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  let shuttingDown = false;

  for (const signal of signals) {
    process.on(signal, async () => {
      if (shuttingDown) return; // Prevent double shutdown
      shuttingDown = true;

      if (process.env.NODE_ENV !== 'test') {
        getLogger().info(
          {},
          `[autotel] Received ${signal}, flushing telemetry...`,
        );
      }

      try {
        await shutdown();
      } catch (error) {
        getLogger().error(
          {
            err: error instanceof Error ? error : undefined,
          },
          '[autotel] Error during shutdown',
        );
      } finally {
        process.exit(0);
      }
    });
  }
}

// Auto-register shutdown hooks
registerShutdownHooks();

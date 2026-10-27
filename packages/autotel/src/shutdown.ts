/**
 * Graceful shutdown with flush and cleanup
 */

import { logs } from '@opentelemetry/api-logs';
import {
  getSdk,
  getLogger,
  getConfig,
  _closeEmbeddedDevtools,
  _releaseSdk,
} from './init';
import { getEventQueue, resetEventQueue } from './track';
import { resetEvents } from './event';
import { resetMetrics } from './metric';
import { getForceFlushableProvider } from './tracer-provider';
import { uninstallProcessHandlers } from './process-handlers';
import { asRecord, asString, isFunction, readProperty } from './values';

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

function errorCode(cause: unknown): string | undefined {
  return asString(readProperty(cause, 'code'));
}

/**
 * A bare "Flush timeout" left you with a stack trace into bundled internals and
 * nothing to act on. Name how long we waited and where we were sending, since
 * the usual cause is that nothing is listening at that endpoint.
 */
function flushTimeoutMessage(timeout: number): string {
  const endpoint = getConfig()?.endpoint;
  const target = endpoint === undefined ? '' : ` sending to ${endpoint}`;
  return (
    `Flush timeout after ${timeout}ms${target}. ` +
    'No collector acknowledged the export; check that one is running and reachable.'
  );
}

/**
 * True when the error (or every error it wraps) is an unreachable-endpoint
 * failure. Traverses `AggregateError.errors` and the `cause` chain, since the
 * SDK often wraps the underlying network error.
 */
function isUnreachableEndpointError(cause: unknown, depth = 0): boolean {
  if (depth > 5 || asRecord(cause) === undefined) return false;

  if (cause instanceof AggregateError) {
    return (
      cause.errors.length > 0 &&
      cause.errors.every((e) => isUnreachableEndpointError(e, depth + 1))
    );
  }

  const code = errorCode(cause);
  if (code && UNREACHABLE_ENDPOINT_CODES.has(code)) return true;

  const wrapped = readProperty(cause, 'cause');
  return wrapped !== undefined && wrapped !== cause
    ? isUnreachableEndpointError(wrapped, depth + 1)
    : false;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Flush all pending telemetry
 *
 * Flushes queued events, OpenTelemetry spans, and log records to their destinations.
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

    // Flush spans and logs independently, so one signal's export error
    // leaves the other flushed. The shared timeout bounds both.
    await Promise.allSettled([
      Promise.resolve().then(() =>
        getForceFlushableProvider(getSdk())?.forceFlush(),
      ),
      Promise.resolve().then(() => {
        // Read at flush time to include providers registered by sdkFactory.
        // Before registration the no-op provider has no forceFlush.
        const provider = logs.getLoggerProvider();
        const forceFlush = readProperty(provider, 'forceFlush');
        if (isFunction(forceFlush)) return forceFlush.call(provider);
      }),
    ]);
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
          () => reject(new Error(flushTimeoutMessage(timeout))),
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
 * The SDK shutdown (which exports anything a tail sampler still holds) is
 * bounded by `timeout`, else `init({ shutdownTimeoutMs })`, else 10s. Past it, shutdown logs a warning,
 * cleans up and resolves, so an unreachable endpoint never holds the process
 * open. A real shutdown error is still thrown after cleanup.
 *
 * @param options.timeout - Milliseconds to wait for the SDK; overrides
 *   `shutdownTimeoutMs` from `init()` (default 10000)
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
export async function shutdown(options?: { timeout?: number }): Promise<void> {
  const timeout =
    options?.timeout ??
    getConfig()?.shutdownTimeoutMs ??
    DEFAULT_SHUTDOWN_TIMEOUT_MS;
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
  const sdk = getSdk();
  try {
    // Shutdown OpenTelemetry SDK
    if (sdk) {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        Promise.resolve(sdk.shutdown()).then(() => false),
        new Promise<true>((resolve) => {
          timer = setTimeout(() => resolve(true), timeout);
          timer.unref();
        }),
      ]).finally(() => clearTimeout(timer));
      if (timedOut) {
        logger.warn(
          {},
          `[autotel] SDK shutdown did not finish within ${timeout}ms; continuing without it`,
        );
      }
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
    // Free the globals, or a later init() registers nothing.
    if (sdk) _releaseSdk(sdk);
    uninstallProcessHandlers();
    await _closeEmbeddedDevtools();

    // Clean up singleton Maps and queues to prevent memory leaks
    // This runs even if SDK shutdown fails
    const eventsQueue = getEventQueue();
    if (isFunction(eventsQueue?.cleanup)) {
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

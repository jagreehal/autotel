import { constants } from 'node:os';

let removeOwnedHandlers: Array<() => void> = [];

/**
 * Tracked separately from `removeOwnedHandlers` because the exit flush outlives
 * a call to `installProcessHandlers`, which clears that list before installing
 * its own signal listeners.
 */
let removeExitFlush: (() => void) | undefined;

/**
 * Shared across every path that can end the process: signals, fatal errors and
 * a clean exit. They can overlap — a container stopping a job that has just
 * finished its work sends SIGTERM while the exit flush is still draining — and
 * a second shutdown would tear down queues the first is still using.
 */
let shutdownInFlight: Promise<void> | undefined;

/**
 * The clean-exit flush, while it runs. Doubles as the latch that keeps a
 * re-emitted `beforeExit` from flushing twice, and as the thing a shutdown
 * waits on rather than tearing down queues mid-drain.
 */
let exitFlushInFlight: Promise<void> | undefined;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

function runShutdownOnce(
  shutdown: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  if (shutdownInFlight) {
    return shutdownInFlight;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  // Queued behind any clean-exit flush: a SIGTERM landing on a job that has
  // just finished its work would otherwise tear down the queues that flush is
  // still draining. The race below still bounds the pair.
  const shutdownAttempt = Promise.resolve(exitFlushInFlight)
    .then(shutdown)
    .catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, timeoutMs);
    timeoutHandle.unref();
  });

  shutdownInFlight = Promise.race([shutdownAttempt, timeout]).then(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
  return shutdownInFlight;
}

export interface ProcessHandlersConfig {
  /** Signals that should trigger telemetry shutdown before process exit. Default: `['SIGTERM', 'SIGINT']`. */
  signals?: NodeJS.Signals[];
  /** Flush telemetry before exiting on uncaught exceptions or rejections. Default: `true`. */
  fatalErrors?: boolean;
  /** Maximum time to wait for telemetry shutdown before exiting. Default: 2000. */
  shutdownTimeoutMs?: number;
}

const DEFAULT_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + constants.signals[signal];
}

/**
 * Surface a fatal error before shutting down.
 *
 * Registering an `uncaughtException` / `unhandledRejection` listener overrides
 * Node's default of printing the stack to stderr, so without this a crash under
 * `fatalErrors` would exit silently. Autotel's own logger is silent by default,
 * so we print to stderr directly to guarantee the crash stays visible.
 */
function reportFatalError(error: unknown, event: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[autotel] ${event}, flushing telemetry then exiting`, err);
}

export function installProcessHandlers(
  config: ProcessHandlersConfig,
  shutdown: () => Promise<void>,
): void {
  uninstallProcessHandlers();

  const timeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  let exitScheduled = false;
  let resolvedExitCode = 0;
  let fatalLatched = false;

  // Exit once, after shutdown completes (or times out). A fatal error's code (1)
  // takes precedence over a signal's code, so a crash is never masked by a
  // concurrent SIGTERM/SIGINT arriving in the same shutdown window.
  const shutdownAndExit = (exitCode: number, fatal: boolean): void => {
    if (fatal) {
      if (!fatalLatched) {
        resolvedExitCode = exitCode;
        fatalLatched = true;
      }
    } else if (!exitScheduled && !fatalLatched) {
      resolvedExitCode = exitCode;
    }

    if (exitScheduled) {
      return;
    }
    exitScheduled = true;
    void runShutdownOnce(shutdown, timeoutMs).then(() => {
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(resolvedExitCode);
    });
  };

  for (const signal of config.signals ?? DEFAULT_SIGNALS) {
    const listener = () => {
      shutdownAndExit(signalExitCode(signal), false);
    };
    process.on(signal, listener);
    removeOwnedHandlers.push(() => {
      process.removeListener(signal, listener);
    });
  }

  if (config.fatalErrors ?? true) {
    const uncaughtExceptionListener = (error: unknown) => {
      reportFatalError(error, 'uncaughtException');
      shutdownAndExit(1, true);
    };
    const unhandledRejectionListener = (reason: unknown) => {
      reportFatalError(reason, 'unhandledRejection');
      shutdownAndExit(1, true);
    };
    process.on('uncaughtException', uncaughtExceptionListener);
    process.on('unhandledRejection', unhandledRejectionListener);
    removeOwnedHandlers.push(
      () => {
        process.removeListener('uncaughtException', uncaughtExceptionListener);
      },
      () => {
        process.removeListener(
          'unhandledRejection',
          unhandledRejectionListener,
        );
      },
    );
  }
}

/**
 * Flush telemetry when the process runs to completion.
 *
 * The signal and fatal-error handlers above cover a process that is stopped or
 * that crashes. Neither fires when a script simply finishes: the event loop
 * drains and Node exits, taking whatever the batch span processor was still
 * holding with it. `beforeExit` is the only hook for that case, and it is the
 * one that matters for CLIs, cron jobs, CI steps and serverless handlers.
 *
 * A flush, never a shutdown: `beforeExit` fires on *any* event-loop drain, not
 * only the final one, so tearing the SDK down here would silently kill
 * telemetry in a process that goes on to do more work.
 */
export function installExitFlush(
  flushTelemetry: () => Promise<void>,
  timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): void {
  // Idempotent: init() runs again in test suites, under hot reload, and
  // wherever telemetry is reconfigured at runtime.
  removeExitFlush?.();
  exitFlushInFlight = undefined;

  const listener = (code: number) => {
    // Node re-emits `beforeExit` once this handler schedules async work, and a
    // shutdown already in flight is draining the same queues.
    if (exitFlushInFlight || shutdownInFlight) return;

    // The bound has to be an exit. An exporter that accepts the connection and
    // never answers holds a ref'd socket, so a timeout that only settles a
    // promise leaves the CLI hanging for the exporter's own retry schedule.
    const deadline = setTimeout(() => {
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(process.exitCode ?? code);
    }, timeoutMs);
    exitFlushInFlight = flushTelemetry()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(deadline);
      });
  };
  process.on('beforeExit', listener);
  removeExitFlush = () => {
    process.removeListener('beforeExit', listener);
    removeExitFlush = undefined;
  };
}

export function uninstallProcessHandlers(): void {
  for (const removeHandler of removeOwnedHandlers) {
    removeHandler();
  }
  removeOwnedHandlers = [];
  removeExitFlush?.();
  shutdownInFlight = undefined;
  exitFlushInFlight = undefined;
}

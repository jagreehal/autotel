import { constants } from 'node:os';

let removeOwnedHandlers: Array<() => void> = [];

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

  let shutdownInFlight: Promise<void> | undefined;
  const runShutdownOnce = (): Promise<void> => {
    if (shutdownInFlight) {
      return shutdownInFlight;
    }

    const timeoutMs = config.shutdownTimeoutMs ?? 2000;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const shutdownAttempt = Promise.resolve()
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
  };

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
    void runShutdownOnce().then(() => {
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

export function uninstallProcessHandlers(): void {
  for (const removeHandler of removeOwnedHandlers) {
    removeHandler();
  }
  removeOwnedHandlers = [];
}

import { afterEach, describe, expect, it, vi } from 'vitest';

// @types/node narrows signal listeners to per-signal overloads, so iterating a
// `NodeJS.Signals` union needs a plain function type here.
type AnyListener = (...args: unknown[]) => void;

const signalListeners = (signal: NodeJS.Signals): AnyListener[] =>
  process.listeners(signal) as AnyListener[];

const originalListeners = new Map<NodeJS.Signals, Set<AnyListener>>([
  ['SIGTERM', new Set(signalListeners('SIGTERM'))],
  ['SIGINT', new Set(signalListeners('SIGINT'))],
]);
const originalUncaughtExceptionListeners = new Set(
  process.listeners('uncaughtException'),
);
const originalUnhandledRejectionListeners = new Set(
  process.listeners('unhandledRejection'),
);

afterEach(() => {
  for (const [signal, listeners] of originalListeners) {
    for (const listener of signalListeners(signal)) {
      if (!listeners.has(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
  for (const listener of process.listeners('uncaughtException')) {
    if (!originalUncaughtExceptionListeners.has(listener)) {
      process.removeListener('uncaughtException', listener);
    }
  }
  for (const listener of process.listeners('unhandledRejection')) {
    if (!originalUnhandledRejectionListeners.has(listener)) {
      process.removeListener('unhandledRejection', listener);
    }
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('process handler lifecycle', () => {
  it('does not install process handlers when the package is imported', async () => {
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');

    await import('./index');

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
  });

  it('installs the default signal and fatal handlers with processHandlers: true', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const unhandledRejectionListeners =
      process.listenerCount('unhandledRejection');
    const { init } = await import('./index');

    init({
      service: 'process-handler-shorthand-test',
      sdkFactory: () => sdk as never,
      processHandlers: true,
    });

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners + 1);
    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners + 1,
    );
    expect(process.listenerCount('unhandledRejection')).toBe(
      unhandledRejectionListeners + 1,
    );
  });

  it('lets explicit config disable individual defaults', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const sigtermListeners = process.listenerCount('SIGTERM');
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const { init } = await import('./index');

    init({
      service: 'process-handler-opt-out-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: [],
        fatalErrors: false,
      },
    });

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners,
    );
  });

  it('shuts down and preserves the exit code when an enabled signal arrives', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const sigtermListeners = process.listenerCount('SIGTERM');
    const { init } = await import('./index');

    init({
      service: 'process-handler-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'],
      },
    });

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners + 1);

    process.emit('SIGTERM', 'SIGTERM');

    await vi.waitFor(() => {
      expect(sdk.shutdown).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(143);
    });

    exit.mockRestore();
  });

  it('exits after the configured timeout when telemetry shutdown hangs', async () => {
    vi.useFakeTimers();
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn(() => new Promise<void>(() => {})),
      getTracerProvider: () => undefined,
    };
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const { init } = await import('./index');

    init({
      service: 'process-handler-timeout-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'],
        shutdownTimeoutMs: 25,
      },
    });

    process.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(25);

    expect(exit).toHaveBeenCalledWith(143);

    exit.mockRestore();
    vi.useRealTimers();
  });

  it('shuts down and exits with failure after an uncaught exception', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const { init } = await import('./index');

    init({
      service: 'fatal-process-handler-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        fatalErrors: true,
      },
    });

    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners + 1,
    );

    process.emit(
      'uncaughtException',
      new Error('fatal test error'),
      'uncaughtException',
    );

    await vi.waitFor(() => {
      expect(sdk.shutdown).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(1);
    });

    // The fatal error must be surfaced, not swallowed. Registering the listener
    // suppresses Node's default stderr print, so we restore it ourselves.
    const args = errorLog.mock.calls.at(-1)!;
    expect(String(args[0])).toContain('uncaughtException');
    expect(args[1]).toBeInstanceOf(Error);
    expect((args[1] as Error).message).toBe('fatal test error');

    exit.mockRestore();
  });

  it('shuts down and exits with failure after an unhandled rejection', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandledRejectionListeners =
      process.listenerCount('unhandledRejection');
    const { init } = await import('./index');

    init({
      service: 'rejection-process-handler-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        fatalErrors: true,
      },
    });

    expect(process.listenerCount('unhandledRejection')).toBe(
      unhandledRejectionListeners + 1,
    );

    process.emit(
      'unhandledRejection',
      new Error('rejected test promise'),
      Promise.resolve(),
    );

    await vi.waitFor(() => {
      expect(sdk.shutdown).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(1);
    });

    const args = errorLog.mock.calls.at(-1)!;
    expect(String(args[0])).toContain('unhandledRejection');
    expect(args[1]).toBeInstanceOf(Error);
    expect((args[1] as Error).message).toBe('rejected test promise');

    exit.mockRestore();
  });

  it('does not duplicate owned handlers when init is called again', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const sigtermListeners = process.listenerCount('SIGTERM');
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const unhandledRejectionListeners =
      process.listenerCount('unhandledRejection');
    const { init } = await import('./index');
    const config = {
      service: 'reinitialized-process-handler-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'] as NodeJS.Signals[],
        fatalErrors: true,
      },
    };

    init(config);
    init(config);

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners + 1);
    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners + 1,
    );
    expect(process.listenerCount('unhandledRejection')).toBe(
      unhandledRejectionListeners + 1,
    );
  });

  it('removes owned process handlers when telemetry is shut down', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const sigtermListeners = process.listenerCount('SIGTERM');
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const unhandledRejectionListeners =
      process.listenerCount('unhandledRejection');
    const { init, shutdown } = await import('./index');

    init({
      service: 'process-handler-cleanup-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'],
        fatalErrors: true,
      },
    });

    await shutdown();

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners,
    );
    expect(process.listenerCount('unhandledRejection')).toBe(
      unhandledRejectionListeners,
    );
  });

  it('removes previously enabled handlers when the latest init omits them', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const sigtermListeners = process.listenerCount('SIGTERM');
    const uncaughtExceptionListeners =
      process.listenerCount('uncaughtException');
    const { init } = await import('./index');

    init({
      service: 'process-handlers-enabled-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'],
        fatalErrors: true,
      },
    });
    init({
      service: 'process-handlers-disabled-test',
      sdkFactory: () => sdk as never,
    });

    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('uncaughtException')).toBe(
      uncaughtExceptionListeners,
    );
  });

  it('runs one shutdown when multiple process events arrive', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getTracerProvider: () => undefined,
    };
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { init } = await import('./index');

    init({
      service: 'concurrent-process-handler-test',
      sdkFactory: () => sdk as never,
      processHandlers: {
        signals: ['SIGTERM'],
        fatalErrors: true,
      },
    });

    process.emit('SIGTERM', 'SIGTERM');
    process.emit(
      'uncaughtException',
      new Error('second fatal event'),
      'uncaughtException',
    );

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });
    expect(sdk.shutdown).toHaveBeenCalledOnce();
    // The fatal error's exit code wins over the concurrent SIGTERM (143).
    expect(exit).toHaveBeenCalledWith(1);
    expect(exit).not.toHaveBeenCalledWith(143);

    exit.mockRestore();
  });

  it('swallows an unreachable-endpoint error wrapped in a cause during shutdown', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi
        .fn()
        .mockRejectedValue(
          new Error('exporter flush failed', {
            cause: { code: 'ECONNREFUSED' },
          }),
        ),
      getTracerProvider: () => undefined,
    };
    const { init, shutdown } = await import('./index');

    init({
      service: 'shutdown-unreachable-test',
      sdkFactory: () => sdk as never,
    });

    // No configured OTLP endpoint: a wrapped connection-refused is expected and
    // must not turn shutdown into a rejection.
    await expect(shutdown()).resolves.toBeUndefined();
    expect(sdk.shutdown).toHaveBeenCalledOnce();
  });

  it('rethrows a real SDK shutdown error', async () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockRejectedValue(new Error('exporter is misconfigured')),
      getTracerProvider: () => undefined,
    };
    const { init, shutdown } = await import('./index');

    init({
      service: 'shutdown-real-error-test',
      sdkFactory: () => sdk as never,
    });

    await expect(shutdown()).rejects.toThrow('exporter is misconfigured');
  });
});

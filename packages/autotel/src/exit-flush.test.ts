import { afterEach, describe, expect, it, vi } from 'vitest';

type AnyListener = (...args: unknown[]) => void;

const beforeExitListeners = (): AnyListener[] =>
  process.listeners('beforeExit') as AnyListener[];

const originalBeforeExitListeners = new Set(beforeExitListeners());

afterEach(async () => {
  for (const listener of beforeExitListeners()) {
    if (!originalBeforeExitListeners.has(listener)) {
      process.removeListener('beforeExit', listener);
    }
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * A process that runs to completion never receives a signal and never crashes,
 * so the signal and fatal-error handlers do not fire. Node emits `beforeExit`
 * instead, which is the only hook that lets a script flush what the batch
 * processor is still holding. Without it a CLI, a cron job, or any script that
 * ends by returning from main loses its telemetry with no diagnostic at all.
 */
describe('flush on clean exit', () => {
  it('flushes when the event loop drains', async () => {
    const { installExitFlush } = await import('./process-handlers');
    const flush = vi.fn().mockResolvedValue(undefined);

    installExitFlush(flush);
    process.emit('beforeExit', 0);
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  });

  it('flushes once even though the flush itself re-arms beforeExit', async () => {
    // Node re-emits `beforeExit` after a handler schedules async work, and
    // flushing is async. Flushing on every emission would, with a slow
    // exporter, keep the process alive.
    const { installExitFlush } = await import('./process-handlers');
    const flush = vi.fn().mockResolvedValue(undefined);

    installExitFlush(flush);
    process.emit('beforeExit', 0);
    process.emit('beforeExit', 0);
    process.emit('beforeExit', 0);

    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  });

  it('does not tear telemetry down: a drained loop is not always an exit', async () => {
    // `beforeExit` fires on any event-loop drain, including one the process
    // recovers from. Shutting the SDK down here would silently discard every
    // span, event and metric produced afterwards.
    const { installExitFlush } = await import('./process-handlers');
    const flush = vi.fn().mockResolvedValue(undefined);
    const before = process.listenerCount('SIGTERM');

    installExitFlush(flush);
    process.emit('beforeExit', 0);
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));

    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('exits rather than waiting on an exporter that never answers', async () => {
    // A timeout that only settles a promise is not a bound: the exporter's
    // socket keeps the loop alive for its own retry schedule. Only exiting
    // caps the delay a CLI pays on the way out.
    vi.useFakeTimers();
    const { installExitFlush } = await import('./process-handlers');
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    installExitFlush(() => new Promise<void>(() => {}), 2000);
    process.emit('beforeExit', 7);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(exit).toHaveBeenCalledWith(7);

    exit.mockRestore();
    vi.useRealTimers();
  });

  it('does not flush while a shutdown is already draining the same queues', async () => {
    // A container stopping a job that has just finished its work: the event
    // loop drains, SIGTERM arrives, shutdown starts. A flush racing that
    // teardown reads queues it is dismantling.
    const { installExitFlush, installProcessHandlers } = await import(
      './process-handlers'
    );
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const flush = vi.fn().mockResolvedValue(undefined);

    installProcessHandlers(
      { signals: ['SIGTERM'], fatalErrors: false },
      shutdown,
    );
    installExitFlush(flush);

    process.emit('SIGTERM', 'SIGTERM');
    process.emit('beforeExit', 0);

    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();

    exit.mockRestore();
  });

  it('stops listening once telemetry has been shut down explicitly', async () => {
    // shutdown() uninstalls the handlers. A listener left behind would fire on
    // the way out and flush a tracer provider that no longer exists.
    const { installExitFlush, uninstallProcessHandlers } = await import(
      './process-handlers'
    );
    const flush = vi.fn().mockResolvedValue(undefined);
    const before = process.listenerCount('beforeExit');

    installExitFlush(flush);
    expect(process.listenerCount('beforeExit')).toBe(before + 1);

    uninstallProcessHandlers();
    expect(process.listenerCount('beforeExit')).toBe(before);

    process.emit('beforeExit', 0);
    expect(flush).not.toHaveBeenCalled();
  });

  it('keeps one listener however many times telemetry is initialised', async () => {
    // init() is called more than once by test suites, by hot reload, and by
    // anything that reconfigures telemetry at runtime. One listener per call
    // leaks them until Node warns about a memory leak at ten.
    const { installExitFlush } = await import('./process-handlers');
    const flush = vi.fn().mockResolvedValue(undefined);
    const before = process.listenerCount('beforeExit');

    installExitFlush(flush);
    installExitFlush(flush);
    installExitFlush(flush);

    expect(process.listenerCount('beforeExit')).toBe(before + 1);

    process.emit('beforeExit', 0);
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  });
});

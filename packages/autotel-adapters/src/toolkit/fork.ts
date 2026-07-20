import type { ForkLifecycle, RequestLogger } from 'autotel';

/**
 * Wrap an existing request logger's `fork()` so adapter lifecycle hooks run
 * for background work spawned after the response returns.
 */
export function attachForkToLogger(
  logger: RequestLogger,
  lifecycle: ForkLifecycle,
): void {
  const originalFork = logger.fork.bind(logger);
  logger.fork = (
    label: string,
    fn: () => void | Promise<void>,
    options?: { lifecycle?: ForkLifecycle },
  ) => {
    originalFork(label, fn, {
      lifecycle: {
        onChildEnter: (child) => {
          lifecycle.onChildEnter?.(child);
          options?.lifecycle?.onChildEnter?.(child);
        },
        onChildExit: (child) => {
          lifecycle.onChildExit?.(child);
          options?.lifecycle?.onChildExit?.(child);
        },
      },
    });
  };
}

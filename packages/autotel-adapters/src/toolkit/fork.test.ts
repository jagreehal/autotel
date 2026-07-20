import { describe, expect, it, vi } from 'vitest';
import type { ForkLifecycle, RequestLogger } from 'autotel';
import { attachForkToLogger } from './fork';

describe('attachForkToLogger', () => {
  it('forwards fork lifecycle hooks to the underlying logger.fork', () => {
    const onChildEnter = vi.fn();
    const onChildExit = vi.fn();
    const lifecycle: ForkLifecycle = { onChildEnter, onChildExit };

    const childLogger = { label: 'child' } as unknown as RequestLogger;
    const originalFork = vi.fn(
      (
        _label: string,
        fn: () => void,
        options?: { lifecycle?: ForkLifecycle },
      ) => {
        options?.lifecycle?.onChildEnter?.(childLogger);
        fn();
        options?.lifecycle?.onChildExit?.(childLogger);
      },
    );

    const logger = {
      fork: originalFork,
    } as unknown as RequestLogger;

    attachForkToLogger(logger, lifecycle);
    logger.fork('background', () => undefined);

    expect(originalFork).toHaveBeenCalledTimes(1);
    expect(onChildEnter).toHaveBeenCalledWith(childLogger);
    expect(onChildExit).toHaveBeenCalledWith(childLogger);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { RequestLogger } from 'autotel';
import { attachForkToLogger } from './fork';
import { createLoggerStorage, createStorageForkLifecycle } from './storage';

describe('createStorageForkLifecycle', () => {
  it('enters forked loggers into adapter storage', () => {
    const { storage, useLogger } = createLoggerStorage('test handler');
    const parent = { tag: 'parent' } as unknown as RequestLogger;
    const child = { tag: 'child' } as unknown as RequestLogger;

    parent.fork = vi.fn(
      (
        _label: string,
        fn: () => void,
        options?: { lifecycle?: { onChildEnter?: (logger: RequestLogger) => void } },
      ) => {
        options?.lifecycle?.onChildEnter?.(child);
        storage.run(child, fn);
      },
    ) as RequestLogger['fork'];

    attachForkToLogger(parent, createStorageForkLifecycle(storage));

    storage.run(parent, () => {
      parent.fork('background', () => {
        expect(useLogger()).toBe(child);
      });
    });
  });
});

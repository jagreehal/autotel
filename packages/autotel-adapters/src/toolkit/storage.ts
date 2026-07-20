import { AsyncLocalStorage } from 'node:async_hooks';
import type { ForkLifecycle, RequestLogger } from 'autotel';

/**
 * Create a request-scoped `AsyncLocalStorage` and matching `useLogger`
 * accessor. Framework adapters call this once at module level.
 *
 * Prefer `import { createLoggerStorage } from 'autotel-adapters/toolkit/storage'`
 * on Cloudflare Workers / edge so `node:async_hooks` is not pulled through the
 * main `autotel-adapters/toolkit` barrel.
 */
export function createLoggerStorage(contextHint: string) {
  const storage = new AsyncLocalStorage<RequestLogger>();

  function useLogger(): RequestLogger {
    const logger = storage.getStore();
    if (!logger) {
      throw new Error(
        `[autotel-adapters] useLogger() was called outside of an autotel ${contextHint}`,
      );
    }
    return logger;
  }

  return { storage, useLogger };
}

/** Bind forked loggers into the adapter's request-scoped storage. */
export function createStorageForkLifecycle(
  storage: AsyncLocalStorage<RequestLogger>,
): ForkLifecycle {
  return {
    onChildEnter: (child) => {
      storage.enterWith(child);
    },
  };
}

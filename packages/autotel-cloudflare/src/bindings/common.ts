/**
 * Common instrumentation utilities
 */

/**
 * Promise tracker for waitUntil
 */
export class PromiseTracker {
  private promises: Promise<unknown>[] = [];

  track(promise: Promise<unknown>): void {
    this.promises.push(promise);
  }

  async wait(): Promise<void> {
    await Promise.allSettled(this.promises);
  }
}

/**
 * Proxy ExecutionContext to track waitUntil promises
 */
export function proxyExecutionContext(ctx: ExecutionContext): {
  ctx: ExecutionContext;
  tracker: PromiseTracker;
} {
  const tracker = new PromiseTracker();

  const proxied = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'waitUntil') {
        return (promise: Promise<unknown>) => {
          tracker.track(promise);
          return target.waitUntil(promise);
        };
      }
      return Reflect.get(target, prop);
    },
  });

  return { ctx: proxied, tracker };
}

/**
 * Helper to wrap/unwrap proxied objects
 */
const unwrapSymbol = Symbol('unwrap');

type Wrapped<T> = { [unwrapSymbol]: T } & T;

export function isWrapped<T>(item: T): item is Wrapped<T> {
  return item && !!(item as Wrapped<T>)[unwrapSymbol];
}

export function unwrap<T extends object>(item: T): T {
  if (item && isWrapped(item)) {
    return item[unwrapSymbol];
  } else {
    return item;
  }
}

export function wrap<T extends object>(
  item: T,
  handler: ProxyHandler<T>,
): Wrapped<T> {
  const proxy = new Proxy(item, handler) as Wrapped<T>;
  Object.defineProperty(proxy, unwrapSymbol, {
    value: item,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return proxy;
}

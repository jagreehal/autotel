import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ROOT_CONTEXT,
  type Context,
  type ContextManager,
} from '@opentelemetry/api';

/**
 * The API's default context manager is a no-op, so `context.with()` would not
 * propagate and a span started inside it has no parent. Tests that rely on ambient
 * parenting register this, as `init()` registers AsyncLocalStorage in an app.
 * Twelve lines are cheaper than a dependency on
 * `@opentelemetry/context-async-hooks` for tests.
 */
export class TestContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    activeContext: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(activeContext, () => fn.call(thisArg, ...args));
  }
  bind<T>(_context: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this.storage.disable();
    return this;
  }
}

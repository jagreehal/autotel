/**
 * AsyncLocalStorage-based context manager for edge environments
 *
 * Copyright The OpenTelemetry Authors
 * Licensed under the Apache License, Version 2.0
 */

import type { ContextManager, Context } from '@opentelemetry/api';
import { ROOT_CONTEXT } from '@opentelemetry/api';

//@ts-ignore - node:async_hooks available in CF Workers with nodejs_compat
import { AsyncLocalStorage } from 'node:async_hooks';
//@ts-ignore
import { EventEmitter } from 'node:events';

type Func<T> = (...args: unknown[]) => T;

/**
 * Store a map for each event of all original listeners and their "patched"
 * version. So when a listener is removed by the user, the corresponding
 * patched function will be also removed.
 */
interface PatchMap {
  [name: string]: WeakMap<Func<void>, Func<void>>;
}

const ADD_LISTENER_METHODS = [
  'addListener' as const,
  'on' as const,
  'once' as const,
  'prependListener' as const,
  'prependOnceListener' as const,
];

abstract class AbstractAsyncHooksContextManager implements ContextManager {
  abstract active(): Context;

  abstract with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F>;

  abstract enable(): this;

  abstract disable(): this;

  /**
   * Binds a context to the target function or event emitter
   */
  bind<T>(context: Context, target: T): T {
    if (target instanceof EventEmitter) {
      return this._bindEventEmitter(context, target);
    }

    if (typeof target === 'function') {
      return this._bindFunction(context, target);
    }
    return target;
  }

  private _bindFunction<T extends Function>(context: Context, target: T): T {
    const manager = this;
    const contextWrapper = function (this: never, ...args: unknown[]) {
      return manager.with(context, () => target.apply(this, args));
    };
    Object.defineProperty(contextWrapper, 'length', {
      enumerable: false,
      configurable: true,
      writable: false,
      value: target.length,
    });
    return contextWrapper as any;
  }

  /**
   * By default, EventEmitter calls callbacks with their context, which we do
   * not want. Instead we bind a specific context to all callbacks.
   */
  private _bindEventEmitter<T extends EventEmitter>(
    context: Context,
    ee: T,
  ): T {
    const map = this._getPatchMap(ee);
    if (map !== undefined) return ee;
    this._createPatchMap(ee);

    // Patch methods that add a listener to propagate context
    for (const methodName of ADD_LISTENER_METHODS) {
      if (ee[methodName] === undefined) continue;
      ee[methodName] = this._patchAddListener(ee, ee[methodName], context);
    }

    // Patch methods that remove a listener
    if (typeof ee.removeListener === 'function') {
      ee.removeListener = this._patchRemoveListener(ee, ee.removeListener);
    }
    if (typeof ee.off === 'function') {
      ee.off = this._patchRemoveListener(ee, ee.off);
    }

    // Patch method that removes all listeners
    if (typeof ee.removeAllListeners === 'function') {
      ee.removeAllListeners = this._patchRemoveAllListeners(
        ee,
        ee.removeAllListeners,
      );
    }
    return ee;
  }

  private _patchRemoveListener(ee: EventEmitter, original: Function) {
    const contextManager = this;
    return function (this: never, event: string, listener: Func<void>) {
      const events = contextManager._getPatchMap(ee)?.[event];
      if (events === undefined) {
        return original.call(this, event, listener);
      }
      const patchedListener = events.get(listener);
      return original.call(this, event, patchedListener || listener);
    };
  }

  private _patchRemoveAllListeners(ee: EventEmitter, original: Function) {
    const contextManager = this;
    return function (this: never, event: string) {
      const map = contextManager._getPatchMap(ee);
      if (map !== undefined) {
        if (arguments.length === 0) {
          contextManager._createPatchMap(ee);
        } else if (map[event] !== undefined) {
          delete map[event];
        }
      }
      return Reflect.apply(original, this, arguments);
    };
  }

  private _patchAddListener(
    ee: EventEmitter,
    original: Function,
    context: Context,
  ) {
    const contextManager = this;
    return function (this: never, event: string, listener: Func<void>) {
      /**
       * This check prevents double-wrapping the listener.
       * The implementation for ee.once wraps the listener and calls ee.on.
       * Without this check, we would wrap that wrapped listener.
       */
      if (contextManager._wrapped) {
        return original.call(this, event, listener);
      }
      let map = contextManager._getPatchMap(ee);
      if (map === undefined) {
        map = contextManager._createPatchMap(ee);
      }
      let listeners = map[event];
      if (listeners === undefined) {
        listeners = new WeakMap();
        map[event] = listeners;
      }
      const patchedListener = contextManager.bind(context, listener);
      // Store a weak reference of the user listener to ours
      listeners.set(listener, patchedListener);

      contextManager._wrapped = true;
      try {
        return original.call(this, event, patchedListener);
      } finally {
        contextManager._wrapped = false;
      }
    };
  }

  private _createPatchMap(ee: EventEmitter): PatchMap {
    const map = Object.create(null);
    (ee as any)[this._kOtListeners] = map;
    return map;
  }

  private _getPatchMap(ee: EventEmitter): PatchMap | undefined {
    return (ee as never)[this._kOtListeners];
  }

  private readonly _kOtListeners = Symbol('OtListeners');
  private _wrapped = false;
}

/**
 * AsyncLocalStorage-based context manager for edge runtimes
 */
export class AsyncLocalStorageContextManager extends AbstractAsyncHooksContextManager {
  private _asyncLocalStorage: AsyncLocalStorage<Context>;

  constructor() {
    super();
    this._asyncLocalStorage = new AsyncLocalStorage();
  }

  active(): Context {
    return this._asyncLocalStorage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const cb = thisArg == null ? fn : fn.bind(thisArg);
    return this._asyncLocalStorage.run(context, cb as never, ...args);
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this._asyncLocalStorage.disable();
    return this;
  }
}

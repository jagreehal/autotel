import { describe, expect, it } from 'vitest';
import { enterOrRun } from './trace-context';

type Box<T> = { value: T };

/** The part of AsyncLocalStorage that `enterOrRun` reaches for. */
interface FakeStorage<T> {
  enterWith?: (store: Box<T>) => void;
  getStore: () => Box<T> | undefined;
  run: (store: Box<T>, fn: () => void) => void;
}

/**
 * The fake as the AsyncLocalStorage `enterOrRun` is declared to take.
 */
function asStorage<T>(storage: FakeStorage<T>): never {
  // SAFETY: `enterOrRun` calls getStore, run and - where the runtime has one -
  // enterWith. Nothing else on AsyncLocalStorage is reachable from there.
  return storage as never;
}

function createFakeStorage<T>(initialValue?: T) {
  let currentStore: Box<T> | undefined =
    initialValue === undefined ? undefined : { value: initialValue };
  const runCalls: Array<Box<T>> = [];
  const enterWithCalls: Array<Box<T>> = [];

  const storage: FakeStorage<T> = {
    getStore() {
      return currentStore;
    },
    run(store: Box<T>, fn: () => void) {
      runCalls.push(store);
      const previousStore = currentStore;
      currentStore = store;
      try {
        fn();
      } finally {
        currentStore = previousStore;
      }
    },
    enterWith(store: Box<T>) {
      enterWithCalls.push(store);
      currentStore = store;
    },
  };

  return {
    enterWithCalls,
    runCalls,
    storage,
  };
}

describe('enterOrRun', () => {
  it('mutates the existing store when already inside a run scope', () => {
    const { storage } = createFakeStorage('outer');

    enterOrRun(asStorage(storage), 'updated');

    expect(storage.getStore()?.value).toBe('updated');
  });

  it('falls back to run() when enterWith throws', () => {
    const { runCalls, storage } = createFakeStorage<string>();
    storage.enterWith = () => {
      throw new Error('enterWith not supported');
    };

    enterOrRun(asStorage(storage), 'worker-value');

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.value).toBe('worker-value');
  });

  it('prefers enterWith() when no store exists and the runtime supports it', () => {
    const { enterWithCalls, storage } = createFakeStorage<string>();

    enterOrRun(asStorage(storage), 'node-value');

    expect(enterWithCalls).toHaveLength(1);
    expect(enterWithCalls[0]?.value).toBe('node-value');
    expect(storage.getStore()?.value).toBe('node-value');
  });
});

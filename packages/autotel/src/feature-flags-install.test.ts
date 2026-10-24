import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  autotelOpenFeatureHook,
  findOpenFeature,
  installOpenFeatureHook,
  recordFeatureFlag,
  type OpenFeatureHook,
} from './feature-flags';

const OPENFEATURE_API = Symbol.for('@openfeature/js-sdk/api');

/** The slice of OpenFeature's API singleton the installer uses. */
function fakeOpenFeature() {
  const hooks: OpenFeatureHook[] = [];
  return {
    hooks,
    addHooks: (...added: OpenFeatureHook[]) => hooks.push(...added),
    getHooks: () => hooks,
  };
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[OPENFEATURE_API];
  vi.restoreAllMocks();
});

/** Log records the module emits through the Logs API. */
function captureLogRecords() {
  const emit = vi.fn();
  vi.spyOn(logs, 'getLogger').mockReturnValue({ emit } as never);
  return emit;
}

describe('findOpenFeature', () => {
  it('uses the OpenFeature the app already loaded', () => {
    const api = fakeOpenFeature();
    (globalThis as Record<symbol, unknown>)[OPENFEATURE_API] = api;
    const load = vi.fn();

    expect(findOpenFeature(load)).toBe(api);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the server SDK when the app has not imported it yet', () => {
    const api = fakeOpenFeature();
    const load = vi.fn(() => ({ OpenFeature: api }));

    expect(findOpenFeature(load)).toBe(api);
    expect(load).toHaveBeenCalledWith('@openfeature/server-sdk');
  });

  it('finds nothing without OpenFeature', () => {
    expect(findOpenFeature(() => {})).toBeUndefined();
  });
});

describe('installOpenFeatureHook', () => {
  it('registers the hook once', () => {
    const api = fakeOpenFeature();
    installOpenFeatureHook(api);
    installOpenFeatureHook(api);
    expect(api.hooks).toHaveLength(1);
  });

  it('skips an app that registered the hook itself', () => {
    const api = fakeOpenFeature();
    api.addHooks(autotelOpenFeatureHook());
    installOpenFeatureHook(api);
    expect(api.hooks).toHaveLength(1);
  });
});

describe('two copies of the hook', () => {
  it('record one evaluation once', () => {
    // One from `init()`, one an app added by hand: OpenFeature hands both the
    // same details object.
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    const hooks = [
      autotelOpenFeatureHook({ getSpan: () => span }),
      autotelOpenFeatureHook({ getSpan: () => span }),
    ];
    const details = { value: true };
    for (const hook of hooks) {
      hook.after?.({ flagKey: 'k', defaultValue: false }, details);
    }
    expect(span.track).toHaveBeenCalledTimes(1);
  });

  it('records two evaluations that share a context object', () => {
    const span = { setAttributes: vi.fn(), track: vi.fn() };
    const hook = autotelOpenFeatureHook({ getSpan: () => span });
    const context = { targetingKey: 'user-42' };
    hook.after?.(
      { flagKey: 'a', defaultValue: false, context },
      { value: true },
    );
    hook.after?.(
      { flagKey: 'b', defaultValue: false, context },
      { value: true },
    );
    expect(span.track).toHaveBeenCalledTimes(2);
  });
});

describe('recordFeatureFlag without a sink', () => {
  it('records onto the active span and emits a log record', () => {
    const emit = captureLogRecords();
    const span = {
      setAttributes: vi.fn(),
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }),
    };

    context.with(trace.setSpan(context.active(), span as never), () => {
      recordFeatureFlag({ key: 'new-checkout', value: true });
    });

    expect(span.setAttributes).toHaveBeenCalledWith({
      'feature_flag.key': 'new-checkout',
      'feature_flag.result.value': true,
    });
    expect(emit).toHaveBeenCalledWith({
      eventName: 'feature_flag.evaluation',
      attributes: {
        'feature_flag.key': 'new-checkout',
        'feature_flag.result.value': true,
      },
    });
  });

  it('still emits the event outside any span', () => {
    const emit = captureLogRecords();
    expect(() => recordFeatureFlag({ key: 'k', value: false })).not.toThrow();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

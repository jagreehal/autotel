import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { context } from '@opentelemetry/api';
import type { AttributeValue, Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { BeforeSendFn } from 'posthog-js';
import { joinPostHog } from './join';

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

// PostHog's own hook type, so the double cannot drift from what before_send
// actually accepts.
type Hook = BeforeSendFn;

/** A PostHog double with the mutable config `set_config` writes through. */
function fakePostHog(before_send?: Hook | Hook[]) {
  const instance = {
    config: { before_send } as { before_send?: Hook | Hook[] },
    // Loosely typed on purpose: PostHog's own `set_config` takes the whole
    // config object, and this double only cares about the one key.
    set_config(patch: Record<string, unknown>) {
      Object.assign(instance.config, patch);
    },
    get_session_id: () => 'sess_1',
    get_distinct_id: () => 'usr_1',
    get_session_replay_url: () => 'https://eu.posthog.com/replay/sess_1?t=3',
    sessionRecordingStarted: () => true,
  };
  return instance;
}

const hooks = (p: ReturnType<typeof fakePostHog>): Hook[] => {
  const value = p.config.before_send;
  return Array.isArray(value) ? value : value ? [value] : [];
};

describe('joinPostHog', () => {
  it('wires the PostHog side without being told twice', () => {
    const posthog = fakePostHog();

    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(1);
  });

  it('returns the enricher, so one call covers both directions', () => {
    const posthog = fakePostHog();

    const enricher = joinPostHog(posthog);
    const attributes: Attributes = {};
    const span = {
      name: 'GET /',
      attributes,
      setAttribute: (k: string, v: AttributeValue) => {
        attributes[k] = v;
      },
      events: [],
      status: { code: 0 },
    } as unknown as ReadableSpan;
    enricher.onStart(span as never, undefined as never);

    expect(span.attributes['session.id']).toBe('sess_1');
  });

  it('keeps hooks the app already registered', () => {
    // before_send is a chain the page may already be using to redact or drop
    // events. Replacing it would silently switch that off.
    const existing: Hook = (e) => e;
    const posthog = fakePostHog([existing]);

    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(2);
    expect(hooks(posthog)[0]).toBe(existing);
  });

  it('accepts a single hook that was not in an array', () => {
    const existing: Hook = (e) => e;
    const posthog = fakePostHog(existing);

    joinPostHog(posthog);

    expect(hooks(posthog)).toEqual([existing, expect.any(Function)]);
  });

  it('does not stack up on repeated calls', () => {
    // Framework code runs twice: React strict mode, HMR, a re-render. Adding
    // the hook again each time would stamp the same properties repeatedly and
    // grow the chain without bound.
    const posthog = fakePostHog();

    joinPostHog(posthog);
    joinPostHog(posthog);
    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(1);
  });

  it('still returns a working enricher when PostHog cannot be configured', () => {
    // The loader stub has no set_config. The trace side must still work.
    const stub = { get_session_id: () => 'sess_1' };

    const enricher = joinPostHog(stub);
    const attributes: Attributes = {};
    const span = {
      name: 'GET /',
      attributes,
      setAttribute: (k: string, v: AttributeValue) => {
        attributes[k] = v;
      },
      events: [],
      status: { code: 0 },
    } as unknown as ReadableSpan;

    expect(() =>
      enricher.onStart(span as never, undefined as never),
    ).not.toThrow();
    expect(span.attributes['session.id']).toBe('sess_1');
  });
});

describe('the loader snippet', () => {
  // The snippet leaves an array on `window.posthog` that queues calls, then
  // posthog-js *replaces* that array with the real instance once it loads.
  // Anything holding the array from before is holding a corpse.
  const snippetStub = () => [] as unknown as ReturnType<typeof fakePostHog>;

  const startSpan = (enricher: ReturnType<typeof joinPostHog>) => {
    const attributes: Attributes = {};
    enricher.onStart(
      {
        attributes,
        setAttribute: (k: string, v: AttributeValue) => {
          attributes[k] = v;
        },
      } as never,
      undefined as never,
    );
    return attributes;
  };

  afterEach(() => {
    delete globalThis.posthog;
  });

  it('finds the real library after the snippet swaps it in', () => {
    const stub = snippetStub();
    globalThis.posthog = stub;
    const enricher = joinPostHog(stub);

    globalThis.posthog = {
      get_session_id: () => 'live-session',
    };

    expect(startSpan(enricher)['session.id']).toBe('live-session');
  });

  it('wires before_send once PostHog can accept it', () => {
    // The stub has no set_config, so the PostHog half cannot be wired at call
    // time. Giving up permanently would leave every PostHog event without its
    // trace for the life of the page.
    const stub = snippetStub();
    globalThis.posthog = stub;
    const enricher = joinPostHog(stub);

    const real = fakePostHog();
    globalThis.posthog = real;
    startSpan(enricher);

    expect(hooks(real)).toHaveLength(1);
  });

  it('prefers an instance passed in over whatever is global', () => {
    // Two PostHog instances on one page is a real setup; an explicit argument
    // is a decision and must not be second-guessed.
    const explicit = fakePostHog();
    globalThis.posthog = {
      get_session_id: () => 'the-other-one',
    };

    expect(startSpan(joinPostHog(explicit))['session.id']).toBe('sess_1');
  });
});

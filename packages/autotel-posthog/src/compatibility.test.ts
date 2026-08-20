import { describe, expect, it } from 'vitest';
import type { AttributeValue, Attributes } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { posthogCompatibility } from './compatibility';

function spanWith(
  attributes: Attributes = {},
  extra: Partial<ReadableSpan> = {},
): ReadableSpan {
  return {
    name: 'GET /checkout',
    attributes,
    // A span is writable while it runs, and `setAttribute` is how identity is
    // stamped at the start, so the double has to offer it.
    setAttribute(key: string, value: AttributeValue) {
      attributes[key] = value;
      return this;
    },
    events: [],
    status: { code: 0 },
    ...extra,
  } as unknown as ReadableSpan;
}

const errorSpan = (attributes: Attributes = {}) =>
  spanWith({ 'exception.type': 'TypeError', ...attributes }, {
    status: { code: 2, message: 'card declined' },
  } as never);

/**
 * Drive a span through the processor the way the SDK does — started, then
 * ended. Identity is captured at the start and only the replay link is decided
 * at the end, so a test that calls one hook tests half the behaviour.
 */
function run(
  processor: ReturnType<typeof posthogCompatibility>,
  span: ReadableSpan,
): ReadableSpan {
  processor.onStart(span as never, undefined as never);
  processor.onEnd(span);
  return span;
}

/** A page with PostHog loaded and session replay actually recording. */
const posthog = {
  get_session_id: () => '0195f1c2-8b3a-7000-9000-abcdef012345',
  get_distinct_id: () => 'usr_8f21c0',
  get_session_replay_url: () => 'https://eu.posthog.com/replay/0195f1c2?t=42',
  sessionRecordingStarted: () => true,
};

describe('posthogCompatibility', () => {
  it('adopts the session PostHog is already recording against', () => {
    const span = run(posthogCompatibility({ posthog }), spanWith());

    expect(span.attributes['session.id']).toBe(
      '0195f1c2-8b3a-7000-9000-abcdef012345',
    );
  });

  it('carries the person PostHog identified', () => {
    const span = run(posthogCompatibility({ posthog }), spanWith());

    expect(span.attributes['user.id']).toBe('usr_8f21c0');
  });
});

describe('identity is a fact about when the span ran', () => {
  it('records the session in force when the operation started', () => {
    // PostHog rotates a session after 30 minutes idle, and identify() can land
    // mid-request. A long span asking at the end would be filed under whoever
    // the visitor had become by then rather than who started it.
    let current = 'sess_early';
    const rotating = { ...posthog, get_session_id: () => current };
    const processor = posthogCompatibility({ posthog: rotating });
    const span = spanWith();

    processor.onStart(span as never, undefined as never);
    current = 'sess_late';
    processor.onEnd(span);

    expect(span.attributes['session.id']).toBe('sess_early');
  });

  it('records the person identified at the start, not the end', () => {
    let who: string | undefined = undefined;
    const identifying = {
      ...posthog,
      get_distinct_id: () => who ?? 'anon_1',
    };
    const processor = posthogCompatibility({ posthog: identifying });
    const span = spanWith();

    processor.onStart(span as never, undefined as never);
    who = 'usr_after_login';
    processor.onEnd(span);

    expect(span.attributes['user.id']).toBe('anon_1');
  });

  it('withholds the replay link when the session moved on', () => {
    // get_session_replay_url() describes the session PostHog is in now. Once
    // that is a different session from the one the span was stamped with, the
    // link points at a recording the span has nothing to do with.
    let current = 'sess_early';
    const rotating = {
      ...posthog,
      get_session_id: () => current,
      get_session_replay_url: () => 'https://eu.posthog.com/replay/sess_late',
    };
    const processor = posthogCompatibility({ posthog: rotating });
    const span = errorSpan();

    processor.onStart(span as never, undefined as never);
    current = 'sess_late';
    processor.onEnd(span);

    expect(span.attributes['session.id']).toBe('sess_early');
    expect(span.attributes['session.replay.url']).toBeUndefined();
  });
});

describe('a PostHog that cannot answer yet', () => {
  it('adds nothing when there is no posthog on the page', () => {
    const span = run(posthogCompatibility({ posthog: undefined }), spanWith());

    expect(span.attributes['session.id']).toBeUndefined();
  });

  it('survives the loader snippet stub, which has none of these methods', () => {
    // Before posthog-js arrives, `window.posthog` is an array that queues
    // calls. Reaching for get_session_id() on it throws.
    const stub = [] as unknown as typeof posthog;

    expect(() =>
      run(posthogCompatibility({ posthog: stub }), spanWith()),
    ).not.toThrow();
  });

  it('skips the empty session id a half-initialized instance returns', () => {
    const span = run(
      posthogCompatibility({
        posthog: { ...posthog, get_session_id: () => '' },
      }),
      spanWith(),
    );

    expect(span.attributes['session.id']).toBeUndefined();
    // The person is still known, so the span keeps what it can.
    expect(span.attributes['user.id']).toBe('usr_8f21c0');
  });

  it('never overwrites what the span already decided', () => {
    const span = run(
      posthogCompatibility({ posthog }),
      spanWith({ 'user.id': 'usr_from_baggage' }),
    );

    expect(span.attributes['user.id']).toBe('usr_from_baggage');
  });
});

describe('the replay link', () => {
  it('deep-links the replay from a span that failed', () => {
    const span = run(posthogCompatibility({ posthog }), errorSpan());

    expect(span.attributes['session.replay.url']).toBe(
      'https://eu.posthog.com/replay/0195f1c2?t=42',
    );
  });

  it('asks for the timestamp, not just the session', () => {
    let received: unknown;

    run(
      posthogCompatibility({
        posthog: {
          ...posthog,
          get_session_replay_url: (options) => {
            received = options;
            return 'https://eu.posthog.com/replay/x?t=1';
          },
        },
      }),
      errorSpan(),
    );

    expect(received).toMatchObject({ withTimestamp: true });
  });

  it('leaves healthy spans without one', () => {
    // Every span carrying a replay URL is noise, and on a busy page it is a
    // lot of noise: the link only earns its place where something went wrong.
    const span = run(posthogCompatibility({ posthog }), spanWith());

    expect(span.attributes['session.replay.url']).toBeUndefined();
  });

  it('emits no link when recording never started', () => {
    // get_session_replay_url() builds a URL from the session id whether or not
    // anything was recorded, so an ungated link sends people to an empty
    // player — worse than no link, because they stop trusting the ones that
    // do work.
    const span = run(
      posthogCompatibility({
        posthog: { ...posthog, sessionRecordingStarted: () => false },
      }),
      errorSpan(),
    );

    expect(span.attributes['session.replay.url']).toBeUndefined();
  });

  it('stays quiet when the instance cannot say either way', () => {
    // An instance too old or too stubbed to expose the check cannot confirm a
    // replay exists, and a confident wrong link is the failure worth avoiding.
    const noAnswer: Partial<typeof posthog> = { ...posthog };
    delete noAnswer.sessionRecordingStarted;

    const span = run(posthogCompatibility({ posthog: noAnswer }), errorSpan());

    expect(span.attributes['session.replay.url']).toBeUndefined();
  });

  it('accepts the legacy recorder flag when that is all there is', () => {
    const legacy: Partial<typeof posthog> & {
      sessionRecording?: { started?: boolean };
    } = { ...posthog, sessionRecording: { started: true } };
    delete legacy.sessionRecordingStarted;

    const span = run(posthogCompatibility({ posthog: legacy }), errorSpan());

    expect(span.attributes['session.replay.url']).toBe(
      'https://eu.posthog.com/replay/0195f1c2?t=42',
    );
  });
});

describe('feature flags', () => {
  const flagged = {
    ...posthog,
    getFeatureFlag: (key: string) =>
      ({ 'new-checkout': 'variant-b', 'legacy-cart': false })[key] as
        string | boolean | undefined,
  };

  it('stamps the flags you name, so latency can be sliced by variant', () => {
    const span = run(
      posthogCompatibility({
        posthog: flagged,
        featureFlags: ['new-checkout'],
      }),
      spanWith(),
    );

    expect(span.attributes['feature_flag.new-checkout']).toBe('variant-b');
  });

  it('keeps a flag that evaluated to false', () => {
    // "Not in the variant" is an answer, and the question people ask is
    // whether the ones who are in it fail more often than the ones who are not.
    const span = run(
      posthogCompatibility({ posthog: flagged, featureFlags: ['legacy-cart'] }),
      spanWith(),
    );

    expect(span.attributes['feature_flag.legacy-cart']).toBe(false);
  });

  it('omits a flag PostHog has no opinion on', () => {
    const span = run(
      posthogCompatibility({
        posthog: flagged,
        featureFlags: ['never-shipped'],
      }),
      spanWith(),
    );

    expect(span.attributes['feature_flag.never-shipped']).toBeUndefined();
  });

  it('reads no flags unless asked', () => {
    // Every flag is a new attribute on every span. Naming them is what keeps
    // an analytics convenience from becoming a cardinality bill.
    let called = false;
    run(
      posthogCompatibility({
        posthog: {
          ...posthog,
          getFeatureFlag: () => {
            called = true;
            return true;
          },
        },
      }),
      spanWith(),
    );

    expect(called).toBe(false);
  });
});

describe('who owns the session id', () => {
  it('replaces an id the tracer minted for itself', () => {
    // autotel-web mints a session id when it is on its own. The moment PostHog
    // is on the page, PostHog's id is the one the replay, the funnels and the
    // person profile are all keyed on — a span carrying any other id links to
    // nothing.
    const span = run(
      posthogCompatibility({ posthog }),
      spanWith({ 'session.id': 'locally-minted' }),
    );

    expect(span.attributes['session.id']).toBe(
      '0195f1c2-8b3a-7000-9000-abcdef012345',
    );
  });

  it('keeps the existing id when PostHog has none to offer', () => {
    const span = run(
      posthogCompatibility({
        posthog: { ...posthog, get_session_id: () => '' },
      }),
      spanWith({ 'session.id': 'locally-minted' }),
    );

    expect(span.attributes['session.id']).toBe('locally-minted');
  });
});

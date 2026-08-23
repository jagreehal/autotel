import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttributeValue, Attributes } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { posthogCompatibility } from './compatibility';

/**
 * Every way this join can fail is quiet by design: a missing PostHog, a
 * rotated session, a project with replay switched off. That is right in
 * production and wrong in the five minutes someone spends wiring it up, where
 * silence is indistinguishable from success. `debug` is the switch that makes
 * those exits say why.
 */

function failedSpan(attributes: Attributes = {}): ReadableSpan {
  const own: Attributes = { 'exception.type': 'TypeError', ...attributes };
  return {
    name: 'POST /checkout',
    attributes: own,
    setAttribute(key: string, value: AttributeValue) {
      own[key] = value;
      return this;
    },
    events: [],
    status: { code: 2, message: 'card declined' },
  } as unknown as ReadableSpan;
}

function run(
  processor: ReturnType<typeof posthogCompatibility>,
  span: ReadableSpan,
): void {
  processor.onStart(span as never, undefined as never);
  processor.onEnd(span);
}

const warnings = (): string[] =>
  vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.posthog = undefined;
  process.env.NODE_ENV = originalNodeEnv;
});

describe('debug diagnostics', () => {
  it('says why a failed span got no replay link', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notRecording = {
      get_session_id: () => 'sess_1',
      get_distinct_id: () => 'usr_1',
      get_session_replay_url: () => 'https://us.posthog.com/replay/sess_1',
      sessionRecordingStarted: () => false,
    };

    run(
      posthogCompatibility({ posthog: notRecording, debug: true }),
      failedSpan(),
    );

    expect(warnings().join(' ')).toMatch(/not recording/i);
  });

  it('says so when there is no PostHog to read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    run(posthogCompatibility({ debug: true }), failedSpan());

    expect(warnings().join(' ')).toMatch(/posthog/i);
  });

  it('says so when the session rotated out from under the span', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rotated = {
      get_session_id: () => 'sess_2',
      get_distinct_id: () => 'usr_1',
      get_session_replay_url: () => 'https://us.posthog.com/replay/sess_2',
      sessionRecordingStarted: () => true,
    };

    const processor = posthogCompatibility({ posthog: rotated, debug: true });
    const span = failedSpan({ 'session.id': 'sess_1' });
    processor.onEnd(span);

    expect(warnings().join(' ')).toMatch(/rotated|session/i);
  });

  it('warns once, however many spans hit the same problem', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const processor = posthogCompatibility({ debug: true });

    run(processor, failedSpan());
    run(processor, failedSpan());
    run(processor, failedSpan());

    expect(warnings()).toHaveLength(1);
  });

  it('stays quiet when the join is working', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const working = {
      get_session_id: () => 'sess_1',
      get_distinct_id: () => 'usr_1',
      get_session_replay_url: () => 'https://us.posthog.com/replay/sess_1?t=4',
      sessionRecordingStarted: () => true,
    };

    run(posthogCompatibility({ posthog: working, debug: true }), failedSpan());

    expect(warnings()).toEqual([]);
  });

  it('warns in development without being asked', () => {
    // The default is loud while you build and silent once you ship. An opt-in
    // diagnostic is read by people who already know something is wrong, and
    // not knowing is the entire failure mode here.
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    run(posthogCompatibility(), failedSpan());

    expect(warnings()).toHaveLength(1);
  });

  it('stays quiet in production, however broken the wiring', () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    run(posthogCompatibility(), failedSpan());

    expect(warnings()).toEqual([]);
  });

  it('takes debug: false as the last word', () => {
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    run(posthogCompatibility({ debug: false }), failedSpan());

    expect(warnings()).toEqual([]);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureSession,
  getSessionAttributes,
  resetSessionForTesting,
} from './session';
import { captureEvents, eventsNamed } from './test-events';
import { resetEventSinkForTesting, setEventSink } from './emit-event';

afterEach(() => {
  vi.useRealTimers();
  resetSessionForTesting();
  resetEventSinkForTesting();
});

describe('session lifecycle events', () => {
  beforeEach(() => {
    captureEvents();
    resetSessionForTesting();
  });

  it('emits session.start for a new session', () => {
    configureSession({ emitEvents: true });
    const attrs = getSessionAttributes()!;

    const [span] = eventsNamed('session.start');
    expect(span).toBeDefined();
    expect(span.attributes['session.id']).toBe(attrs['session.id']);
  });

  it('emits start once, not on every span', () => {
    configureSession({ emitEvents: true });
    getSessionAttributes();
    getSessionAttributes();
    getSessionAttributes();
    expect(eventsNamed('session.start')).toHaveLength(1);
  });

  it('closes the old session before starting the new one on rollover', () => {
    vi.useFakeTimers();
    configureSession({ timeoutMs: 5000, emitEvents: true });
    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(3000);
    getSessionAttributes(); // still the same session, three seconds in
    vi.advanceTimersByTime(5001);
    const second = getSessionAttributes()!;

    const [ended] = eventsNamed('session.end');
    expect(ended.attributes['session.id']).toBe(first['session.id']);
    expect(ended.attributes['session.end.reason']).toBe('timeout');
    // The session ended when it went idle, not when we noticed: three seconds
    // of activity, not eight.
    expect(ended.attributes['session.duration']).toBe(3);
    expect(eventsNamed('session.start')).toHaveLength(2);
    expect(second['session.previous_id']).toBe(first['session.id']);
  });

  it('stays silent unless events are asked for', () => {
    configureSession({});
    getSessionAttributes();
    expect(eventsNamed('session.start')).toHaveLength(0);
  });

  it('emits nothing for a session another SDK owns', () => {
    // A provider owns its own lifecycle; we cannot know when it starts or ends.
    configureSession({ emitEvents: true, id: () => 'external-id' });
    getSessionAttributes();
    expect(eventsNamed('session.start')).toHaveLength(0);
  });
});

describe('re-entrancy', () => {
  it('survives a sink that reads the session back', () => {
    // The real sink does exactly this: recordEvent() stamps session.id on the
    // log record, so emitting from inside the rollover re-enters this module.
    // A test double that does not read back cannot catch it — which is why the
    // first version of these tests passed while production overflowed the stack.
    vi.useFakeTimers();
    const seen: string[] = [];
    setEventSink((name) => {
      seen.push(name);
      getSessionAttributes();
    });
    configureSession({ timeoutMs: 1000, emitEvents: true });

    getSessionAttributes();
    vi.advanceTimersByTime(1001);
    expect(() => getSessionAttributes()).not.toThrow();
    expect(seen.filter((n) => n === 'session.end')).toHaveLength(1);
  });

  it('reports one rollover, not one per re-entry', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    setEventSink((name) => {
      seen.push(name);
      getSessionAttributes();
    });
    configureSession({ timeoutMs: 1000, emitEvents: true });

    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(1001);
    const second = getSessionAttributes()!;

    expect(seen.filter((n) => n === 'session.start')).toHaveLength(2);
    expect(second['session.id']).not.toBe(first['session.id']);
    expect(second['session.previous_id']).toBe(first['session.id']);
  });

  it('gives a re-entrant reader the new session, not the expired one', () => {
    vi.useFakeTimers();
    let reentrant: Record<string, string> | undefined;
    setEventSink((name) => {
      if (name === 'session.end') reentrant = getSessionAttributes();
    });
    configureSession({ timeoutMs: 1000, emitEvents: true });

    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(1001);
    const second = getSessionAttributes()!;

    expect(reentrant?.['session.id']).toBe(second['session.id']);
    expect(reentrant?.['session.id']).not.toBe(first['session.id']);
  });
});

describe('lifecycle attribution', () => {
  it('attributes session.end to the session that ended', () => {
    // Ambient enrichment stamps the *current* session on every record. Applied
    // after the event's own attributes it overwrites them, and `session.end`
    // then names the session that just started — the one fact the event exists
    // to contradict.
    vi.useFakeTimers();
    configureSession({ timeoutMs: 1000, emitEvents: true });
    const events = captureEvents();

    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(1001);
    const second = getSessionAttributes()!;

    const ended = events.find((e) => e.name === 'session.end');
    expect(ended?.attributes['session.id']).toBe(first['session.id']);
    expect(ended?.attributes['session.id']).not.toBe(second['session.id']);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureSession,
  getSessionAttributes,
  resetSessionForTesting,
} from './session';

afterEach(() => {
  vi.useRealTimers();
  resetSessionForTesting();
});

describe('session', () => {
  it('keeps one id across calls', () => {
    const first = getSessionAttributes();
    const second = getSessionAttributes();

    expect(first?.['session.id']).toBeDefined();
    expect(second?.['session.id']).toBe(first?.['session.id']);
  });

  it('rolls over after the idle window and links the previous session once', () => {
    vi.useFakeTimers();
    configureSession({ timeoutMs: 1000 });

    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(1001);

    const rolled = getSessionAttributes()!;
    expect(rolled['session.id']).not.toBe(first['session.id']);
    expect(rolled['session.previous_id']).toBe(first['session.id']);

    // Only the first span of the new session carries the link.
    expect(getSessionAttributes()!['session.previous_id']).toBeUndefined();
  });

  it('keeps the session alive while activity continues', () => {
    vi.useFakeTimers();
    configureSession({ timeoutMs: 1000 });

    const first = getSessionAttributes()!;
    vi.advanceTimersByTime(800);
    getSessionAttributes();
    vi.advanceTimersByTime(800);

    expect(getSessionAttributes()!['session.id']).toBe(first['session.id']);
  });

  it('survives a reload within the tab', () => {
    const first = getSessionAttributes()!;

    // A reload loses module state but not sessionStorage.
    resetSessionForTestingKeepingStorage(first['session.id']);

    expect(getSessionAttributes()!['session.id']).toBe(first['session.id']);
  });

  it('emits nothing when disabled', () => {
    configureSession(false);
    expect(getSessionAttributes()).toBeUndefined();
  });
});

/** Simulate a page reload: drop in-memory state, keep what storage holds. */
function resetSessionForTestingKeepingStorage(id: string): void {
  const stored = globalThis.sessionStorage.getItem('autotel.session');
  resetSessionForTesting();
  globalThis.sessionStorage.setItem('autotel.session', stored!);
  expect(stored).toContain(id);
}

describe('an external session id provider', () => {
  it('uses the id the provider returns instead of minting one', () => {
    // PostHog (or any other SDK that already owns a session) hands its id in
    // here, so spans, replays and analytics all key on the same value.
    configureSession({ id: () => 'from-posthog' });

    expect(getSessionAttributes()?.['session.id']).toBe('from-posthog');
  });

  it('mints its own when the provider has nothing yet', () => {
    // A provider that is still initializing must not cost the page its session
    // attributes entirely.
    configureSession({ id: () => undefined });

    const id = getSessionAttributes()?.['session.id'];
    expect(id).toBeDefined();
    expect(id).not.toBe('from-posthog');
  });

  it('does not store a provider id as if it were ours', () => {
    // The provider owns the lifecycle. Persisting its id would let a stale
    // value outlive the session it came from.
    configureSession({ id: () => 'from-posthog' });
    getSessionAttributes();

    expect(globalThis.sessionStorage.getItem('autotel.session')).toBeNull();
  });
});

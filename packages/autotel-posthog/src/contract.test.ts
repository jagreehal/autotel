import { describe, expect, it } from 'vitest';
import { PostHog } from 'posthog-js';
import { posthogCompatibility } from './compatibility';
import { joinPostHog } from './join';
import type { PostHogLike } from './posthog-like';

/**
 * Holds this package to `posthog-js` itself rather than to a memory of it.
 *
 * The type assertions below fail to compile if PostHog renames a method or
 * changes a signature; the runtime checks fail if a method this package calls
 * stops existing on the class. Either way the break surfaces here, in CI,
 * instead of as a missing attribute in someone's browser.
 */
describe('posthog-js contract', () => {
  it('accepts a real PostHog instance wherever this package takes one', () => {
    // Compile-time: a full PostHog satisfies the surface this package reads.
    const accepts = (posthog: PostHog): PostHogLike => posthog;

    expect(accepts).toBeTypeOf('function');
  });

  it('still exposes every method this package calls', () => {
    const surface = [
      'get_session_id',
      'get_distinct_id',
      'get_session_replay_url',
      'getFeatureFlag',
      'sessionRecordingStarted',
      'set_config',
    ] as const;

    for (const method of surface) {
      expect(
        typeof PostHog.prototype[method],
        `posthog-js no longer has ${method}()`,
      ).toBe('function');
    }
  });

  it('keeps sessionRecordingStarted as the public replay check', () => {
    // The property this package falls back to is not in PostHog's public type.
    // If the method ever goes away, the fallback is all that is left and the
    // replay link quietly stops appearing — so the method is the thing to
    // watch.
    expect(PostHog.prototype.sessionRecordingStarted).toBeTypeOf('function');
  });

  it('takes a real instance through the public entry points', () => {
    const posthog = new PostHog();

    expect(() => posthogCompatibility({ posthog })).not.toThrow();
    expect(() => joinPostHog(posthog)).not.toThrow();
  });
});

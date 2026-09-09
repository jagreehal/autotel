import { describe, expect, it } from 'vitest';

import { PostHogSubscriber } from './index';

describe('PostHogSubscriber after the move', () => {
  it('still resolves from the package root and says where it went', () => {
    expect(() => new PostHogSubscriber({ apiKey: 'phc_test' })).toThrow(
      /autotel-posthog\/subscriber/,
    );
  });
});

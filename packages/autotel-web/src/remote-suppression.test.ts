// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureException,
  resetErrorTrackingForTesting,
  setupErrorTracking,
} from './error-tracking';
import { captureSpans, spansNamed } from './test-tracer';
import { applyRemoteSuppression } from './remote-config';

beforeEach(() => {
  captureSpans();
  resetErrorTrackingForTesting();
});
afterEach(() => resetErrorTrackingForTesting());

const noisy = () => {
  const error = new Error('ResizeObserver loop limit exceeded');
  error.name = 'ResizeObserverError';
  return error;
};

describe('remotely delivered error suppression', () => {
  it('suppresses an exception named in the remote config', () => {
    // The point of remote: a browser update starts throwing something nobody
    // can fix, and it buries every real error until the next release.
    setupErrorTracking({
      deferToPostHog: false,
      suppressionRules: applyRemoteSuppression([], {
        errorSuppression: [
          { key: 'type', operator: 'exact', value: 'ResizeObserverError' },
        ],
      }),
    });
    captureException(noisy());
    expect(spansNamed('unhandled_error')).toHaveLength(0);
  });

  it('keeps everything else', () => {
    setupErrorTracking({
      deferToPostHog: false,
      suppressionRules: applyRemoteSuppression([], {
        errorSuppression: [
          { key: 'type', operator: 'exact', value: 'ResizeObserverError' },
        ],
      }),
    });
    captureException(new TypeError('real bug'));
    expect(spansNamed('unhandled_error')).toHaveLength(1);
  });

  it('adds to the local rules rather than replacing them', () => {
    // A local rule is in the source for a reason; a config fetch must not be
    // able to switch it off.
    const local = [
      { key: 'type' as const, operator: 'exact' as const, value: 'LocalNoise' },
    ];
    const merged = applyRemoteSuppression(local, {
      errorSuppression: [
        { key: 'type', operator: 'exact', value: 'RemoteNoise' },
      ],
    });
    expect(merged).toHaveLength(2);
    expect(merged?.[0]).toEqual(local[0]);
    expect(merged?.[1]).toMatchObject({ value: 'RemoteNoise' });
  });

  it('leaves the local rules alone when there is no remote config', () => {
    const local = [
      { key: 'type' as const, operator: 'exact' as const, value: 'LocalNoise' },
    ];
    expect(applyRemoteSuppression(local, undefined)).toBe(local);
    expect(applyRemoteSuppression(local, {})).toBe(local);
  });
});

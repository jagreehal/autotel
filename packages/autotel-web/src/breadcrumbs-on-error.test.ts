// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureException,
  resetErrorTrackingForTesting,
  setupErrorTracking,
} from './error-tracking';
import { addBreadcrumb, resetBreadcrumbsForTesting } from './breadcrumbs';
import { captureSpans, spansNamed } from './test-tracer';

beforeEach(() => {
  captureSpans();
  resetBreadcrumbsForTesting();
  resetErrorTrackingForTesting();
});
afterEach(() => resetErrorTrackingForTesting());

describe('exceptions carry the trail leading in', () => {
  it('attaches the breadcrumbs recorded before the error', () => {
    setupErrorTracking({ deferToPostHog: false });
    addBreadcrumb({ message: 'click Buy now', category: 'ui' });
    addBreadcrumb({ message: 'fetch /checkout failed', category: 'fetch' });
    captureException(new Error('boom'));

    const [span] = spansNamed('unhandled_error');
    const trail = JSON.parse(
      span.attributes['exception.breadcrumbs'] as string,
    ) as { message: string }[];
    expect(trail.map((c) => c.message)).toEqual([
      'click Buy now',
      'fetch /checkout failed',
    ]);
  });

  it('says nothing when there is no trail', () => {
    setupErrorTracking({ deferToPostHog: false });
    captureException(new Error('boom'));
    const [span] = spansNamed('unhandled_error');
    expect(span.attributes['exception.breadcrumbs']).toBeUndefined();
  });
});

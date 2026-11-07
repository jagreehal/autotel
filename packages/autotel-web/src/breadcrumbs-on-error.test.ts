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

    const [span] = spansNamed('exception');
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
    const [span] = spansNamed('exception');
    expect(span.attributes['exception.breadcrumbs']).toBeUndefined();
  });
});

describe('the span an exception gets', () => {
  it('is `exception` for a caught error and `unhandled_error` for one nothing caught', () => {
    setupErrorTracking({ deferToPostHog: false });
    captureException(new Error('caught'));
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('uncaught'),
        message: 'uncaught',
      }),
    );

    expect(spansNamed('exception')).toHaveLength(1);
    expect(spansNamed('unhandled_error')).toHaveLength(1);
    expect(spansNamed('exception')[0]!.attributes['error.type']).toBe('Error');
  });

  it('groups chunk-load failures as one issue whatever the chunk', () => {
    setupErrorTracking({ deferToPostHog: false });
    captureException(
      new TypeError(
        'Failed to fetch dynamically imported module: https://app.example.com/assets/index-BW3fp066.js',
      ),
    );
    captureException(new TypeError('Importing a module script failed.'));

    const spans = spansNamed('exception');
    expect(spans.map((span) => span.attributes['error.type'])).toEqual([
      'chunk_load_error',
      'chunk_load_error',
    ]);
    expect(spans[0]!.attributes['exception.fingerprint']).toBe(
      spans[1]!.attributes['exception.fingerprint'],
    );
  });
});

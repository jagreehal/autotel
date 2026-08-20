import { describe, expect, it } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import {
  EXCEPTION_FINGERPRINT_ATTRIBUTE,
  exceptionFingerprint,
  fingerprintException,
} from './exception-fingerprint';
import { readableSpanDouble } from './testing/doubles';

const STACK_LAPTOP = [
  'TypeError: cannot read x of undefined',
  '    at loadUser (/Users/dev/app/src/users.ts:12:9)',
  '    at handler (/Users/dev/app/src/routes.ts:44:3)',
].join('\n');

const STACK_CONTAINER = [
  'TypeError: cannot read x of undefined',
  '    at loadUser (/srv/app/src/users.ts:12:9)',
  '    at handler (/srv/app/src/routes.ts:44:3)',
].join('\n');

function spanWith(
  attributes: Record<string, unknown>,
  events: ReadableSpan['events'] = [],
): ReadableSpan {
  return readableSpanDouble({
    attributes,
    events,
    status: {},
  });
}

describe('fingerprintException', () => {
  it('groups the same throw across machines', () => {
    expect(
      fingerprintException({ type: 'TypeError', stack: STACK_LAPTOP }),
    ).toBe(fingerprintException({ type: 'TypeError', stack: STACK_CONTAINER }));
  });

  it('ignores line moves within a frame', () => {
    const moved = STACK_LAPTOP.replace('users.ts:12:9', 'users.ts:18:9');
    expect(fingerprintException({ type: 'TypeError', stack: moved })).toBe(
      fingerprintException({ type: 'TypeError', stack: STACK_LAPTOP }),
    );
  });

  it('separates different error types on the same stack', () => {
    expect(
      fingerprintException({ type: 'TypeError', stack: STACK_LAPTOP }),
    ).not.toBe(
      fingerprintException({ type: 'RangeError', stack: STACK_LAPTOP }),
    );
  });

  it('collapses dependency paths to the package', () => {
    const a = 'at q (/app/node_modules/pg/lib/client.js:1:1)';
    const b = 'at q (/other/root/node_modules/pg/lib/client.js:1:1)';
    expect(fingerprintException({ type: 'Error', stack: a })).toBe(
      fingerprintException({ type: 'Error', stack: b }),
    );
  });

  it('falls back to a normalized message when there is no stack', () => {
    expect(
      fingerprintException({ type: 'Error', message: 'timeout after 341ms' }),
    ).toBe(
      fingerprintException({ type: 'Error', message: 'timeout after 78ms' }),
    );
  });

  it('returns undefined when there is nothing to group on', () => {
    expect(fingerprintException({})).toBeUndefined();
  });
});

describe('exceptionFingerprint enricher', () => {
  it('stamps spans that recorded an exception event', () => {
    const span = spanWith({}, [
      {
        name: 'exception',
        attributes: {
          'exception.type': 'TypeError',
          'exception.stacktrace': STACK_LAPTOP,
        },
        time: [0, 0],
        droppedAttributesCount: 0,
      },
    ]);

    exceptionFingerprint().onEnd(span);

    expect(span.attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE]).toBe(
      fingerprintException({ type: 'TypeError', stack: STACK_LAPTOP }),
    );
  });

  it('reads structured errors that write error.stack instead of an event', () => {
    const span = spanWith({
      'error.type': 'TypeError',
      'error.stack': STACK_LAPTOP,
    });

    exceptionFingerprint().onEnd(span);

    expect(span.attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE]).toBeDefined();
  });

  it('leaves healthy spans alone', () => {
    const span = spanWith({ 'http.route': '/users' });

    exceptionFingerprint().onEnd(span);

    expect(span.attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE]).toBeUndefined();
  });

  it('never overwrites a fingerprint the span set itself', () => {
    const span = spanWith({
      'exception.type': 'TypeError',
      'exception.stacktrace': STACK_LAPTOP,
      [EXCEPTION_FINGERPRINT_ATTRIBUTE]: 'checkout-declined',
    });

    exceptionFingerprint().onEnd(span);

    expect(span.attributes[EXCEPTION_FINGERPRINT_ATTRIBUTE]).toBe(
      'checkout-declined',
    );
  });
});

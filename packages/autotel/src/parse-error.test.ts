import { describe, expect, it } from 'vitest';
import { createStructuredError } from './structured-error';
import { parseError } from './parse-error';

describe('parseError', () => {
  it('parses structured errors with why/fix/link', () => {
    const err = createStructuredError({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined',
      fix: 'Use another card',
      link: 'https://docs.example.com/payment-errors',
      code: 'PAYMENT_DECLINED',
    });

    const parsed = parseError(err);
    expect(parsed).toMatchObject({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined',
      fix: 'Use another card',
      link: 'https://docs.example.com/payment-errors',
      code: 'PAYMENT_DECLINED',
      raw: err,
    });
  });

  it('parses fetch-like nested data payloads', () => {
    const fetchLikeError = {
      message: 'Request failed',
      statusCode: 409,
      data: {
        statusText: 'Conflict',
        data: {
          why: 'Order already exists',
          fix: 'Use idempotency key',
          link: 'https://docs.example.com/idempotency',
          code: 'ORDER_EXISTS',
        },
      },
    };

    const parsed = parseError(fetchLikeError);
    expect(parsed).toMatchObject({
      message: 'Conflict',
      status: 409,
      why: 'Order already exists',
      fix: 'Use idempotency key',
      link: 'https://docs.example.com/idempotency',
      code: 'ORDER_EXISTS',
      raw: fetchLikeError,
    });
  });

  it('preserves details from structured errors', () => {
    const err = createStructuredError({
      message: 'Export failed',
      status: 500,
      details: { retryable: true, provider: 'stripe' },
    });

    const parsed = parseError(err);
    expect(parsed.details).toEqual({ retryable: true, provider: 'stripe' });
  });

  it('falls back for unknown values', () => {
    expect(parseError('boom')).toMatchObject({
      message: 'boom',
      status: 500,
      raw: 'boom',
    });
  });
});

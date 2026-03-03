import { describe, expect, it } from 'vitest';
import { parseError } from './parse-error';

describe('parseError', () => {
  it('parses Error instances with optional diagnostic fields', () => {
    const err = Object.assign(new Error('Payment failed'), {
      status: 402,
      why: 'Card declined',
      fix: 'Use another card',
      link: 'https://docs.example.com/payments',
      code: 'PAYMENT_DECLINED',
    });

    const parsed = parseError(err);
    expect(parsed).toMatchObject({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined',
      fix: 'Use another card',
      link: 'https://docs.example.com/payments',
      code: 'PAYMENT_DECLINED',
      raw: err,
    });
  });

  it('parses fetch-like payloads with nested data', () => {
    const fetchLike = {
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

    const parsed = parseError(fetchLike);
    expect(parsed).toMatchObject({
      message: 'Conflict',
      status: 409,
      why: 'Order already exists',
      fix: 'Use idempotency key',
      link: 'https://docs.example.com/idempotency',
      code: 'ORDER_EXISTS',
      raw: fetchLike,
    });
  });

  it('preserves details from errors', () => {
    const err = Object.assign(new Error('Export failed'), {
      status: 500,
      details: { retryable: true, provider: 'stripe' },
    });

    const parsed = parseError(err);
    expect(parsed.details).toEqual({ retryable: true, provider: 'stripe' });
  });

  it('falls back for primitives and unknown values', () => {
    expect(parseError('boom')).toMatchObject({
      message: 'boom',
      status: 500,
      raw: 'boom',
    });
  });
});

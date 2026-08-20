import { describe, expect, it } from 'vitest';
import { defineEvent } from './define-event';
import { invalidValue } from './testing/doubles';
import { asString, readProperty } from './values';

describe('defineEvent', () => {
  it('validates payload and exposes schema metadata when provided', () => {
    const event = defineEvent(
      'order.placed',
      {
        safeParse(input: unknown) {
          const orderId = asString(readProperty(input, 'orderId'));
          return orderId === undefined
            ? { success: false as const, error: new Error('invalid') }
            : { success: true as const, data: { orderId } };
        },
      },
      {
        toJsonSchema: () => ({
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        }),
      },
    );

    expect(event.name).toBe('order.placed');
    expect(event.schemaMetadata?.source).toBe('zod');
    expect(event.schemaMetadata?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => event.track({ orderId: 'o-1' })).not.toThrow();
    expect(() => event.track(invalidValue<{ orderId: string }>({}))).toThrow(
      /Schema validation failed/,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { defineEvent } from './define-event';

describe('defineEvent', () => {
  it('validates payload and exposes schema metadata when provided', () => {
    const event = defineEvent(
      'order.placed',
      {
        safeParse(input: unknown) {
          if (
            typeof input === 'object' &&
            input !== null &&
            'orderId' in input &&
            typeof (input as Record<string, unknown>).orderId === 'string'
          ) {
            return {
              success: true as const,
              data: input as { orderId: string },
            };
          }
          return { success: false as const, error: new Error('invalid') };
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
    expect(() => event.track({} as { orderId: string })).toThrow(
      /Schema validation failed/,
    );
  });
});

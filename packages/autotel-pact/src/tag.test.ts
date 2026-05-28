import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACT_ATTRS } from './attrs.js';

const getActiveSpanMock = vi.fn();

vi.mock('autotel', () => ({
  getActiveSpan: () => getActiveSpanMock(),
}));

let tagPactInteraction: typeof import('./tag.js').tagPactInteraction;

beforeEach(async () => {
  getActiveSpanMock.mockReset();
  ({ tagPactInteraction } = await import('./tag.js'));
});

afterEach(() => {
  vi.resetModules();
});

describe('tagPactInteraction', () => {
  it('throws when no active span is present', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    getActiveSpanMock.mockReturnValue(undefined);
    expect(() =>
      tagPactInteraction({
        consumer: 'A',
        provider: 'B',
        description: 'evt',
        states: [],
        kind: 'message',
      }),
    ).toThrowError(/requires an active span/);
  });

  it('stamps pact.* attributes on the active span', () => {
    const setAttributes = vi.fn();
    const setAttribute = vi.fn();
    getActiveSpanMock.mockReturnValue({ setAttributes, setAttribute });

    tagPactInteraction({
      consumer: 'OrderShipper',
      provider: 'OrderService',
      description: 'an OrderCreated event',
      states: ['order exists'],
      kind: 'message',
    });

    expect(setAttributes).toHaveBeenCalledTimes(1);
    const attrs = setAttributes.mock.calls[0]![0] as Record<string, unknown>;
    expect(attrs[PACT_ATTRS.CONSUMER]).toBe('OrderShipper');
    expect(attrs[PACT_ATTRS.PROVIDER]).toBe('OrderService');
    expect(attrs[PACT_ATTRS.KIND]).toBe('message');
  });

  it('sets interaction_id when supplied', () => {
    const setAttributes = vi.fn();
    const setAttribute = vi.fn();
    getActiveSpanMock.mockReturnValue({ setAttributes, setAttribute });

    tagPactInteraction({
      consumer: 'A',
      provider: 'B',
      description: 'evt',
      states: [],
      kind: 'message',
      interactionId: 'iid-123',
    });

    expect(setAttribute).toHaveBeenCalledWith(PACT_ATTRS.INTERACTION_ID, 'iid-123');
  });
});

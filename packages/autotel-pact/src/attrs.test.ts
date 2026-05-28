import { describe, expect, it } from 'vitest';
import { buildPactAttributes, outcomeAttribute, PACT_ATTRS } from './attrs.js';
import type { PactInteractionMeta } from './types.js';

const meta: PactInteractionMeta = {
  consumer: 'OrderShipper',
  provider: 'OrderService',
  description: 'an OrderCreated event',
  states: ['an order exists'],
  kind: 'message',
};

describe('buildPactAttributes', () => {
  it('emits the canonical pact.* attribute set', () => {
    const attrs = buildPactAttributes(meta);
    expect(attrs[PACT_ATTRS.CONSUMER]).toBe('OrderShipper');
    expect(attrs[PACT_ATTRS.PROVIDER]).toBe('OrderService');
    expect(attrs[PACT_ATTRS.KIND]).toBe('message');
    expect(attrs[PACT_ATTRS.INTERACTION_DESCRIPTION]).toBe('an OrderCreated event');
    expect(attrs[PACT_ATTRS.INTERACTION_STATES]).toEqual(['an order exists']);
    expect(attrs[PACT_ATTRS.CONTRACT_FILE]).toBeUndefined();
  });

  it('includes pact.contract.file when supplied', () => {
    const attrs = buildPactAttributes(meta, { contractFile: 'pacts/OrderShipper-OrderService.json' });
    expect(attrs[PACT_ATTRS.CONTRACT_FILE]).toBe('pacts/OrderShipper-OrderService.json');
  });
});

describe('outcomeAttribute', () => {
  it('returns a single-key record for the outcome', () => {
    expect(outcomeAttribute('passed')).toEqual({ [PACT_ATTRS.OUTCOME]: 'passed' });
    expect(outcomeAttribute('failed')).toEqual({ [PACT_ATTRS.OUTCOME]: 'failed' });
  });
});

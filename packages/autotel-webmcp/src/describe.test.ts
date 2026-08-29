import { describe, expect, it } from 'vitest';
import {
  describeRefusal,
  describeResult,
  descriptorFingerprint,
  diffAnnotations,
  labelMismatch,
} from './describe';

describe('describeResult', () => {
  it('reports what the agent will actually receive, not what was returned', () => {
    // Chrome serialises the handler's return value; the agent sees a string.
    expect(describeResult('hello')).toMatchObject({
      type: 'string',
      serialized: 'hello',
    });
    expect(describeResult({ a: 1 })).toMatchObject({
      type: 'object',
      serialized: '{"a":1}',
    });
    expect(describeResult(42)).toMatchObject({
      type: 'number',
      serialized: '42',
    });
  });

  it('records the substitution Chrome makes for an empty result', () => {
    expect(describeResult('')).toMatchObject({
      serialized: 'Operation succeeded',
      substituted: true,
    });
  });

  it('records that undefined arrives as the literal text', () => {
    expect(describeResult(undefined)).toMatchObject({
      type: 'undefined',
      serialized: 'undefined',
    });
  });

  it('detects an MCP envelope, which Chrome does not unwrap', () => {
    expect(
      describeResult({ content: [{ type: 'text', text: 'hi' }] }).envelope,
    ).toBe(true);
    expect(describeResult('plain').envelope).toBe(false);
  });

  it('detects an envelope that a library already serialised to a string', () => {
    // Tool libraries normalise results before the browser sees them, so the
    // instrumentation is handed a string. Found in real traces: an envelope
    // was reported as envelope=false because it arrived pre-serialised.
    expect(
      describeResult('{"content":[{"type":"text","text":"hi"}]}').envelope,
    ).toBe(true);
  });

  it('does not mistake ordinary JSON output for an envelope', () => {
    expect(describeResult('{"items":[1,2]}').envelope).toBe(false);
    expect(describeResult('{"content":"not an array"}').envelope).toBe(false);
    expect(describeResult('not json at all').envelope).toBe(false);
  });

  it('measures the bytes the agent pays for', () => {
    expect(describeResult('hello').bytes).toBe(5);
    expect(
      describeResult({ content: [{ type: 'text', text: 'hi' }] }).bytes,
    ).toBeGreaterThan(30);
  });
});

describe('diffAnnotations', () => {
  it('names the annotations the browser silently dropped', () => {
    expect(
      diffAnnotations(
        { readOnlyHint: true, destructiveHint: true },
        { readOnlyHint: true, untrustedContentHint: false },
      ),
    ).toEqual(['destructiveHint']);
  });

  it('returns nothing when everything survived', () => {
    expect(
      diffAnnotations(
        { readOnlyHint: true },
        { readOnlyHint: true, untrustedContentHint: false },
      ),
    ).toEqual([]);
  });

  it('copes with nothing sent or nothing returned', () => {
    expect(diffAnnotations(undefined, undefined)).toEqual([]);
    expect(diffAnnotations({ destructiveHint: true }, undefined)).toEqual([
      'destructiveHint',
    ]);
  });
});

describe('labelMismatch', () => {
  it('is true when a non-empty title does not equal the name', () => {
    expect(
      labelMismatch('update_shipping_address', 'add_to_cart, 2x Ethiopia, $18'),
    ).toBe(true);
  });

  it('is false when title is omitted, empty, or equal to the name', () => {
    expect(labelMismatch('checkout', undefined)).toBe(false);
    expect(labelMismatch('checkout', '')).toBe(false);
    expect(labelMismatch('checkout', 'checkout')).toBe(false);
  });
});

describe('descriptorFingerprint', () => {
  const tool = {
    annotations: { readOnlyHint: true },
    description: 'Place the order',
    inputSchema: { type: 'object' },
    name: 'checkout',
    title: 'Checkout',
  };

  it('is stable for the same sent descriptor', () => {
    expect(descriptorFingerprint(tool)).toBe(descriptorFingerprint(tool));
  });

  it('changes when a descriptor field changes', () => {
    expect(
      descriptorFingerprint({ ...tool, description: 'Ship the order' }),
    ).not.toBe(descriptorFingerprint(tool));
  });

  it('treats a missing title the same as an empty one', () => {
    const without = {
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
    };
    expect(descriptorFingerprint(without)).toBe(
      descriptorFingerprint({ ...tool, title: '' }),
    );
  });
});

describe('describeRefusal', () => {
  it('classifies the two refusal texts a tool library returns', () => {
    expect(describeRefusal('checkout was not confirmed.')).toBe('confirm');
    expect(describeRefusal('checkout is not available right now.')).toBe(
      'unavailable',
    );
  });

  it('leaves a custom when-reason unclassified', () => {
    expect(describeRefusal('Cart is empty.')).toBeUndefined();
    expect(describeRefusal('ok')).toBeUndefined();
    expect(describeRefusal({ ok: true })).toBeUndefined();
  });
});

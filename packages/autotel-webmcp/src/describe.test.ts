import { describe, expect, it } from 'vitest';
import { describeResult, diffAnnotations } from './describe';

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

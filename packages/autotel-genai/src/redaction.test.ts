import { describe, expect, it } from 'vitest';
import {
  redactBinaryContent,
  serializeWithinBudget,
  truncateUtf8,
} from './redaction.js';

describe('redactBinaryContent', () => {
  it('replaces a data URL with a media-typed placeholder', () => {
    const value = `data:image/png;base64,${'A'.repeat(200)}`;
    expect(redactBinaryContent(value)).toBe('[base64 image/png redacted]');
  });

  it('replaces a data URL with extra parameters', () => {
    const value = `data:audio/wav;charset=utf-8;base64,${'A'.repeat(200)}`;
    expect(redactBinaryContent(value)).toBe('[base64 audio/wav redacted]');
  });

  it('replaces a data URL however short', () => {
    expect(redactBinaryContent('data:image/gif;base64,R0lGOD')).toBe(
      '[base64 image/gif redacted]',
    );
  });

  it('replaces binary buffers rather than inflating them to base64', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(redactBinaryContent(bytes)).toBe('[base64 redacted]');
    expect(redactBinaryContent(bytes.buffer)).toBe('[base64 redacted]');
  });

  it('names the media type of a buffer from a sibling mime hint', () => {
    expect(
      redactBinaryContent({
        mediaType: 'image/jpeg',
        data: new Uint8Array([1, 2, 3]),
      }),
    ).toEqual({
      mediaType: 'image/jpeg',
      data: '[base64 image/jpeg redacted]',
    });
  });

  it('leaves ordinary prose alone', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', content: 'Hello, world.' }] },
    ];
    expect(redactBinaryContent(messages)).toEqual(messages);
  });

  it('leaves a long non-base64 string alone', () => {
    const prose = 'the quick brown fox. '.repeat(200);
    expect(redactBinaryContent(prose)).toBe(prose);
  });

  it('redacts a long bare base64 string with no context at all', () => {
    const blob = 'A'.repeat(1024);
    expect(redactBinaryContent(blob)).toBe('[base64 redacted]');
  });

  it('keeps a short base64-shaped string that has no binary context', () => {
    // A 100-char token is far more likely an id than an image.
    const token = 'A'.repeat(100);
    expect(redactBinaryContent(token)).toBe(token);
  });

  it('redacts a short base64 string under a key that signals binary', () => {
    expect(
      redactBinaryContent({ type: 'input_image', data: 'A'.repeat(100) }),
    ).toEqual({ type: 'input_image', data: '[base64 image redacted]' });
  });

  it('infers audio from a sibling format field', () => {
    expect(
      redactBinaryContent({ format: 'wav', data: 'A'.repeat(100) }),
    ).toEqual({ format: 'wav', data: '[base64 audio/wav redacted]' });
  });

  it('calls a file-family payload a file', () => {
    expect(
      redactBinaryContent({ type: 'input_file', file_data: 'A'.repeat(100) }),
    ).toEqual({ type: 'input_file', file_data: '[base64 file redacted]' });
  });

  it('does not redact text under an explicit text media type', () => {
    const value = { mediaType: 'text/plain', data: 'A'.repeat(100) };
    expect(redactBinaryContent(value)).toEqual(value);
  });

  it('honours an explicit media type for the whole value', () => {
    expect(
      redactBinaryContent('A'.repeat(100), { mediaType: 'image/webp' }),
    ).toBe('[base64 image/webp redacted]');
  });

  it('walks nested arrays and objects', () => {
    expect(
      redactBinaryContent({
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', content: 'describe this' },
              {
                type: 'image',
                image_url: `data:image/png;base64,${'A'.repeat(80)}`,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', content: 'describe this' },
            { type: 'image', image_url: '[base64 image/png redacted]' },
          ],
        },
      ],
    });
  });

  it('survives a circular reference', () => {
    const node: Record<string, unknown> = { role: 'user' };
    node.self = node;
    expect(redactBinaryContent(node)).toEqual({ role: 'user', self: null });
  });

  it('preserves non-string primitives', () => {
    const value = { n: 1, b: true, nil: null, u: undefined };
    expect(redactBinaryContent(value)).toEqual(value);
  });

  it('does not mutate its input', () => {
    const value = { data: `data:image/png;base64,${'A'.repeat(80)}` };
    const before = value.data;
    redactBinaryContent(value);
    expect(value.data).toBe(before);
  });
});

describe('truncateUtf8', () => {
  it('leaves a string under the limit untouched', () => {
    expect(truncateUtf8('hello', 100)).toEqual({
      text: 'hello',
      truncated: false,
      originalBytes: 5,
    });
  });

  it('cuts a string over the limit and reports the original size', () => {
    const result = truncateUtf8('a'.repeat(50), 10);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(50);
    expect(result.text).toBe('a'.repeat(10));
  });

  it('measures the limit in bytes, not characters', () => {
    // '€' is 3 UTF-8 bytes, so four of them exceed a 10-byte budget.
    const result = truncateUtf8('€€€€', 10);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(12);
    expect(result.text).toBe('€€€');
  });

  it('never splits a multi-byte character into a broken one', () => {
    // 8 bytes of budget across 3-byte characters: two fit, the third must go.
    expect(truncateUtf8('€€€', 8).text).toBe('€€');
  });

  it('treats a non-positive limit as no limit', () => {
    const long = 'a'.repeat(1000);
    expect(truncateUtf8(long, 0)).toEqual({
      text: long,
      truncated: false,
      originalBytes: 1000,
    });
  });
});

describe('redactBinaryContent shared references', () => {
  it('keeps a repeated sibling reference instead of nulling it', () => {
    const shared = { role: 'user', parts: [{ type: 'text', content: 'hi' }] };
    expect(redactBinaryContent([shared, shared])).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
      { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
    ]);
  });

  it('keeps a reference repeated across different branches', () => {
    const shared = { type: 'text', content: 'shared part' };
    expect(
      redactBinaryContent({ a: { parts: [shared] }, b: { parts: [shared] } }),
    ).toEqual({
      a: { parts: [{ type: 'text', content: 'shared part' }] },
      b: { parts: [{ type: 'text', content: 'shared part' }] },
    });
  });

  it('redacts every occurrence of a repeated payload', () => {
    const image = { type: 'input_image', data: new Uint8Array(64) };
    expect(redactBinaryContent([image, image])).toEqual([
      { type: 'input_image', data: '[base64 image redacted]' },
      { type: 'input_image', data: '[base64 image redacted]' },
    ]);
  });

  it('counts a repeated payload once per occurrence', () => {
    const image = { type: 'input_image', data: new Uint8Array(64) };
    let redactions = 0;
    redactBinaryContent([image, image], {
      onRedact: () => {
        redactions += 1;
      },
    });
    expect(redactions).toBe(2);
  });

  it('still resolves a real cycle to null', () => {
    const node: Record<string, unknown> = { role: 'user' };
    node.self = node;
    expect(redactBinaryContent([node, node])).toEqual([
      { role: 'user', self: null },
      { role: 'user', self: null },
    ]);
  });

  it('resolves a cycle through an array to null', () => {
    const parts: unknown[] = [];
    const message = { role: 'user', parts };
    parts.push(message);
    expect(redactBinaryContent(message)).toEqual({
      role: 'user',
      parts: [null],
    });
  });
});

describe('serializeWithinBudget', () => {
  const parse = (text: string): unknown => JSON.parse(text);

  it('leaves a structure that fits untouched', () => {
    const value = [{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }];
    const result = serializeWithinBudget(value, 10_000);
    expect(result.truncated).toBe(false);
    expect(parse(result.text)).toEqual(value);
  });

  it('emits valid JSON when a structure exceeds the budget', () => {
    const value = [
      {
        role: 'user',
        parts: [{ type: 'text', content: 'the fox. '.repeat(5000) }],
      },
    ];
    const result = serializeWithinBudget(value, 1000);
    expect(result.truncated).toBe(true);
    expect(() => parse(result.text)).not.toThrow();
  });

  it('keeps the message envelope so a reader still sees the shape', () => {
    const value = [
      {
        role: 'user',
        parts: [{ type: 'text', content: 'the fox. '.repeat(5000) }],
      },
    ];
    const parsed = parse(serializeWithinBudget(value, 2000).text) as {
      role: string;
      parts: { type: string; content: string }[];
    }[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].role).toBe('user');
    expect(parsed[0].parts[0].type).toBe('text');
    expect(parsed[0].parts[0].content).toContain('the fox.');
  });

  it('marks the field it cut', () => {
    const value = [
      { role: 'user', parts: [{ type: 'text', content: 'x '.repeat(5000) }] },
    ];
    expect(serializeWithinBudget(value, 2000).text).toContain('[truncated]');
  });

  it('reports the size before truncation', () => {
    const value = [
      { role: 'user', parts: [{ type: 'text', content: 'a '.repeat(5000) }] },
    ];
    const result = serializeWithinBudget(value, 1000);
    expect(result.originalBytes).toBe(
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
    );
  });

  it('stays inside the budget', () => {
    const value = [
      { role: 'user', parts: [{ type: 'text', content: 'a '.repeat(5000) }] },
    ];
    const result = serializeWithinBudget(value, 1000);
    expect(
      new TextEncoder().encode(result.text).byteLength,
    ).toBeLessThanOrEqual(1000);
  });

  it('keeps an array an array when there are too many small items', () => {
    // Nothing to cut inside each item, so entries have to go instead.
    const value = Array.from({ length: 5000 }, (_, i) => ({
      role: 'user',
      parts: [{ type: 'text', content: `m${i}` }],
    }));
    const result = serializeWithinBudget(value, 1000);
    const parsed = parse(result.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeLessThan(5000);
    expect(result.truncated).toBe(true);
  });

  it('keeps an object an object when there are too many keys', () => {
    const value = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [
        `tool_${i}`,
        { description: 'x' },
      ]),
    );
    const result = serializeWithinBudget(value, 1000);
    const parsed = parse(result.text);
    expect(Array.isArray(parsed)).toBe(false);
    expect(typeof parsed).toBe('object');
  });

  it('slices a plain string, which is valid on its own', () => {
    const result = serializeWithinBudget(
      'the quick brown fox. '.repeat(200),
      100,
    );
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(100);
  });

  it('never throws on a value JSON cannot serialise', () => {
    const node: Record<string, unknown> = { role: 'user' };
    node.self = node;
    const result = serializeWithinBudget(node, 1000);
    expect(() => parse(result.text)).not.toThrow();
  });

  it('treats a non-positive budget as no budget', () => {
    const value = [
      { role: 'user', parts: [{ type: 'text', content: 'a '.repeat(5000) }] },
    ];
    const result = serializeWithinBudget(value, 0);
    expect(result.truncated).toBe(false);
    expect(parse(result.text)).toEqual(value);
  });
});

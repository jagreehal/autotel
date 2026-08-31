import { describe, expect, it, vi } from 'vitest';
import {
  recordEvaluationResult,
  recordInferenceDetails,
  recordModelWarnings,
  recordOperationException,
  setGenAiContent,
} from './events.js';

describe('setGenAiContent', () => {
  it('serialises content onto canonical span attributes', () => {
    const setAttributes = vi.fn();
    const track = vi.fn();
    setGenAiContent(
      { setAttributes, track },
      {
        inputMessages: [
          { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
        ],
        systemInstructions: 'be concise',
      },
    );
    const attrs = setAttributes.mock.calls[0][0];
    expect(attrs['gen_ai.input.messages']).toBeTypeOf('string');
    expect(JSON.parse(attrs['gen_ai.input.messages'])[0].role).toBe('user');
    expect(attrs['gen_ai.system_instructions']).toBe('be concise');
  });

  it('does nothing when no content is supplied', () => {
    const setAttributes = vi.fn();
    setGenAiContent({ setAttributes, track: vi.fn() }, {});
    expect(setAttributes).not.toHaveBeenCalled();
  });
});

describe('recordInferenceDetails', () => {
  it('emits the canonical inference event via ctx.track', () => {
    const track = vi.fn();
    recordInferenceDetails(
      { track },
      {
        operation: 'chat',
        requestModel: 'gpt-4o',
        inputTokens: 10,
        serverAddress: 'api.openai.com',
        serverPort: 443,
      },
    );
    expect(track).toHaveBeenCalledWith(
      'gen_ai.client.inference.operation.details',
      expect.objectContaining({
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.usage.input_tokens': 10,
        'server.address': 'api.openai.com',
        'server.port': 443,
      }),
    );
  });
});

describe('recordEvaluationResult', () => {
  it('emits the evaluation event with the required name', () => {
    const track = vi.fn();
    recordEvaluationResult({ track }, { name: 'relevance', scoreValue: 0.9 });
    expect(track).toHaveBeenCalledWith(
      'gen_ai.evaluation.result',
      expect.objectContaining({
        'gen_ai.evaluation.name': 'relevance',
        'gen_ai.evaluation.score.value': 0.9,
      }),
    );
  });
});

describe('recordOperationException', () => {
  it('emits the canonical exception event', () => {
    const track = vi.fn();
    recordOperationException(
      { track },
      { type: 'timeout', message: 'timed out' },
    );
    expect(track).toHaveBeenCalledWith('gen_ai.client.operation.exception', {
      'exception.type': 'timeout',
      'exception.message': 'timed out',
    });
  });
});

describe('setGenAiContent gating', () => {
  it('honours recordInputs / recordOutputs', () => {
    const setAttributes = vi.fn();
    setGenAiContent(
      { setAttributes, track: vi.fn() },
      {
        inputMessages: 'secret prompt',
        systemInstructions: 'system',
        outputMessages: 'safe completion',
      },
      { recordInputs: false, recordOutputs: true },
    );
    const attrs = setAttributes.mock.calls[0][0];
    expect(attrs).not.toHaveProperty('gen_ai.input.messages');
    expect(attrs).not.toHaveProperty('gen_ai.system_instructions');
    expect(attrs).toHaveProperty('gen_ai.output.messages', 'safe completion');
  });

  it('replaces binary content rather than corrupting or inflating it', () => {
    const setAttributes = vi.fn();
    setGenAiContent(
      { setAttributes, track: vi.fn() },
      {
        inputMessages: [
          {
            role: 'user',
            parts: [{ type: 'file', data: new Uint8Array([1, 2, 3]) }],
          },
        ],
      },
    );
    const serialized = setAttributes.mock.calls[0][0]['gen_ai.input.messages'];
    expect(serialized).toContain('[base64 file redacted]');
    expect(serialized).not.toContain('"0":1'); // not the JSON.stringify corruption
  });
});

describe('recordModelWarnings', () => {
  it('emits a warnings event with a count', () => {
    const track = vi.fn();
    recordModelWarnings({ track }, [
      { type: 'unsupported-setting', setting: 'topK', message: 'ignored' },
    ]);
    expect(track).toHaveBeenCalledWith(
      'gen_ai.client.warnings',
      expect.objectContaining({ 'gen_ai.warnings.count': 1 }),
    );
  });

  it('is a no-op for an empty list', () => {
    const track = vi.fn();
    recordModelWarnings({ track }, []);
    expect(track).not.toHaveBeenCalled();
  });
});

describe('setGenAiContent binary + size limits', () => {
  const capture = (
    content: Parameters<typeof setGenAiContent>[1],
    settings?: Parameters<typeof setGenAiContent>[2],
  ): Record<string, unknown> => {
    const setAttributes = vi.fn();
    setGenAiContent({ setAttributes, track: vi.fn() }, content, settings);
    return (setAttributes.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
  };

  it('redacts binary buffers instead of base64-inflating them', () => {
    const attrs = capture({
      inputMessages: [
        {
          role: 'user',
          parts: [{ type: 'input_image', data: new Uint8Array(4096) }],
        },
      ],
    });
    const serialised = attrs['gen_ai.input.messages'] as string;
    expect(serialised).toContain('[base64 image redacted]');
    expect(serialised.length).toBeLessThan(200);
  });

  it('redacts an inline data URL in message content', () => {
    const attrs = capture({
      outputMessages: [
        {
          role: 'assistant',
          parts: [
            {
              type: 'image',
              image_url: `data:image/png;base64,${'A'.repeat(5000)}`,
            },
          ],
        },
      ],
    });
    expect(attrs['gen_ai.output.messages']).toContain(
      '[base64 image/png redacted]',
    );
  });

  it('labels redacted content as redacted evidence', () => {
    const attrs = capture({
      inputMessages: [
        {
          role: 'user',
          parts: [{ type: 'input_image', data: new Uint8Array(64) }],
        },
      ],
    });
    expect(attrs['autotel.evidence.input']).toBe('redacted');
  });

  it('leaves prose alone and labels no evidence', () => {
    const attrs = capture({
      inputMessages: [
        { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
      ],
    });
    expect(attrs['autotel.evidence.input']).toBeUndefined();
  });

  it('keeps the raw payload when redaction is turned off', () => {
    const attrs = capture(
      { inputMessages: `data:image/png;base64,${'A'.repeat(100)}` },
      { redactBinary: false },
    );
    expect(attrs['gen_ai.input.messages']).toContain('data:image/png;base64,');
  });

  it('truncates content past the byte budget and says by how much', () => {
    const attrs = capture(
      { outputMessages: 'the quick brown fox. '.repeat(250) },
      { maxContentBytes: 100 },
    );
    expect(attrs['gen_ai.output.messages']).toHaveLength(100);
    expect(attrs['gen_ai.output.messages.original_size']).toBe(5250);
    expect(attrs['autotel.evidence.output']).toBe('truncated');
  });

  it('caps content by default without being asked', () => {
    const attrs = capture({
      outputMessages: 'the quick brown fox. '.repeat(15_000),
    });
    expect((attrs['gen_ai.output.messages'] as string).length).toBe(200_000);
    expect(attrs['autotel.evidence.output']).toBe('truncated');
  });

  it('records nothing about size when the content fits', () => {
    const attrs = capture({ outputMessages: 'short' });
    expect(attrs['gen_ai.output.messages.original_size']).toBeUndefined();
    expect(attrs['autotel.evidence.output']).toBeUndefined();
  });

  it('reports truncation rather than redaction when both happened', () => {
    const attrs = capture(
      {
        inputMessages: [
          {
            role: 'user',
            parts: [
              { type: 'input_image', data: new Uint8Array(4096) },
              { type: 'text', content: 'the quick brown fox. '.repeat(250) },
            ],
          },
        ],
      },
      { maxContentBytes: 100 },
    );
    expect(attrs['autotel.evidence.input']).toBe('truncated');
  });

  it('labels system instructions and tool definitions under input', () => {
    const attrs = capture(
      { toolDefinitions: 'a tool, and then. '.repeat(30) },
      {
        maxContentBytes: 100,
      },
    );
    expect(attrs['gen_ai.tool.definitions.original_size']).toBe(540);
    expect(attrs['autotel.evidence.input']).toBe('truncated');
  });

  it('treats a non-positive budget as no budget', () => {
    const attrs = capture(
      { outputMessages: 'the quick brown fox. '.repeat(250) },
      { maxContentBytes: 0 },
    );
    expect((attrs['gen_ai.output.messages'] as string).length).toBe(5250);
  });
});

describe('setGenAiContent keeps truncated content parseable', () => {
  const capture = (
    content: Parameters<typeof setGenAiContent>[1],
    settings?: Parameters<typeof setGenAiContent>[2],
  ): Record<string, unknown> => {
    const setAttributes = vi.fn();
    setGenAiContent({ setAttributes, track: vi.fn() }, content, settings);
    return (setAttributes.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
  };

  const bigMessages = (count = 1) =>
    Array.from({ length: count }, () => ({
      role: 'user',
      parts: [{ type: 'text', content: 'the quick brown fox. '.repeat(2000) }],
    }));

  it('emits JSON a reader can still parse', () => {
    const attrs = capture(
      { inputMessages: bigMessages() },
      { maxContentBytes: 2000 },
    );
    expect(() =>
      JSON.parse(attrs['gen_ai.input.messages'] as string),
    ).not.toThrow();
  });

  it('keeps messages an array, which is what consumers match on', () => {
    const attrs = capture(
      { outputMessages: bigMessages(3) },
      { maxContentBytes: 2000 },
    );
    const parsed = JSON.parse(attrs['gen_ai.output.messages'] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].role).toBe('user');
  });

  it('still reports the original size and labels the loss', () => {
    const attrs = capture(
      { inputMessages: bigMessages() },
      { maxContentBytes: 2000 },
    );
    expect(attrs['gen_ai.input.messages.original_size']).toBeGreaterThan(2000);
    expect(attrs['autotel.evidence.input']).toBe('truncated');
  });

  it('stays inside the budget', () => {
    const attrs = capture(
      { inputMessages: bigMessages(4) },
      { maxContentBytes: 2000 },
    );
    const bytes = new TextEncoder().encode(
      attrs['gen_ai.input.messages'] as string,
    ).byteLength;
    expect(bytes).toBeLessThanOrEqual(2000);
  });

  it('keeps oversized tool definitions parseable too', () => {
    const attrs = capture(
      {
        toolDefinitions: Object.fromEntries(
          Array.from({ length: 400 }, (_, i) => [
            `tool_${i}`,
            { description: 'does a thing. '.repeat(50) },
          ]),
        ),
      },
      { maxContentBytes: 2000 },
    );
    expect(() =>
      JSON.parse(attrs['gen_ai.tool.definitions'] as string),
    ).not.toThrow();
  });

  it('does not throw on content JSON cannot serialise', () => {
    const node: Record<string, unknown> = { role: 'user' };
    node.self = node;
    expect(() =>
      capture({ inputMessages: [node] as never }, { redactBinary: false }),
    ).not.toThrow();
  });
});

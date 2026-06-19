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
        inputMessages: [{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }],
        systemInstructions: 'be concise',
      },
    );
    const attrs = setAttributes.mock.calls[0][0];
    expect(typeof attrs['gen_ai.input.messages']).toBe('string');
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
    recordOperationException({ track }, { type: 'timeout', message: 'timed out' });
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

  it('base64-encodes binary content instead of corrupting it', () => {
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
    expect(serialized).toContain('"__type":"base64"');
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

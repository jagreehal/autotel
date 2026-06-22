import { describe, expect, it } from 'vitest';
import {
  contentToGenAiMessage,
  promptToGenAiMessages,
} from './ai-sdk-messages.js';

describe('promptToGenAiMessages', () => {
  it('splits system messages into systemInstructions and maps string content', () => {
    const result = promptToGenAiMessages([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(result).toEqual({
      messages: [{ role: 'user', parts: [{ type: 'text', content: 'Hi' }] }],
      systemInstructions: [{ type: 'text', content: 'Be terse.' }],
    });
  });

  it('maps tool calls and tool results to GenAI part types', () => {
    const result = promptToGenAiMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          {
            type: 'tool-call',
            toolCallId: 't1',
            toolName: 'weather',
            input: { city: 'SF' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'weather',
            output: { tempC: 18 },
          },
        ],
      },
    ]);
    expect(result.messages).toEqual([
      {
        role: 'assistant',
        parts: [
          { type: 'text', content: 'let me check' },
          {
            type: 'tool_call',
            id: 't1',
            name: 'weather',
            arguments: { city: 'SF' },
          },
        ],
      },
      {
        role: 'tool',
        parts: [
          { type: 'tool_call_response', id: 't1', response: { tempC: 18 } },
        ],
      },
    ]);
    expect(result.systemInstructions).toBeUndefined();
  });

  it('references media by modality + mime type without inlining bytes', () => {
    const result = promptToGenAiMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mediaType: 'image/png', data: 'BYTES' },
        ],
      },
    ]);
    expect(result.messages[0]!.parts).toEqual([
      { type: 'text', content: 'what is this?' },
      { type: 'blob', modality: 'image', mime_type: 'image/png' },
    ]);
  });

  it('returns empty for no messages', () => {
    expect(promptToGenAiMessages()).toEqual({ messages: [] });
    expect(promptToGenAiMessages([])).toEqual({ messages: [] });
  });
});

describe('contentToGenAiMessage', () => {
  it('builds one assistant message with finish_reason from output parts', () => {
    const message = contentToGenAiMessage(
      [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Paris.' },
      ],
      'stop',
    );
    expect(message).toEqual({
      role: 'assistant',
      parts: [
        { type: 'reasoning', content: 'thinking' },
        { type: 'text', content: 'Paris.' },
      ],
      finish_reason: 'stop',
    });
  });

  it('returns undefined for empty content', () => {
    expect(contentToGenAiMessage()).toBeUndefined();
    expect(contentToGenAiMessage([])).toBeUndefined();
  });
});

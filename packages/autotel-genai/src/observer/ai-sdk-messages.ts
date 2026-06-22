/**
 * Vercel AI SDK messages → GenAI SemConv message format.
 *
 * The AI SDK carries prompts as `ModelMessage[]` (role + string-or-parts) and
 * model output as `ContentPart[]`. The GenAI semantic conventions instead model
 * `gen_ai.input.messages` / `gen_ai.output.messages` as `{ role, parts }` where
 * each part is `{ type, ...typeFields }`:
 *
 *   - text:               `{ type: 'text', content }`
 *   - reasoning:          `{ type: 'reasoning', content }`
 *   - tool_call:          `{ type: 'tool_call', id, name, arguments }`
 *   - tool_call_response: `{ type: 'tool_call_response', id, response }`
 *   - blob/uri:           media, referenced by `mime_type` only (never inlined)
 *
 * Typed structurally against the AI SDK shapes (no `ai` / `@ai-sdk/*` import).
 * Media bytes are deliberately not copied onto spans — only the modality and
 * mime type — so content capture never balloons span size or leaks raw blobs.
 */

import type { GenAiMessage, GenAiMessagePart } from '../events.js';

// --- Structural views of the AI SDK message shapes -------------------------
// Exported so the telemetry/channel event views can type their `messages` /
// `content` fields against these directly — no per-call-site casts, and (with no
// index signature) the real SDK `ModelMessage[]` / `ContentPart[]` stay
// assignable to them.

export interface ModelMessageView {
  role?: string;
  content?: string | readonly ContentPartView[];
}

export interface ContentPartView {
  type?: string;
  /** text / reasoning */
  text?: string;
  /** tool-call */
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  /** tool-result */
  output?: unknown;
  /** image / file */
  mediaType?: string;
}

/** Result of converting an AI SDK prompt: messages plus split-out system parts. */
export interface ConvertedPrompt {
  messages: GenAiMessage[];
  systemInstructions?: GenAiMessagePart[];
}

/**
 * Convert an AI SDK `ModelMessage[]` prompt to GenAI input messages, splitting
 * `system` messages out into `systemInstructions` (recorded separately per the
 * conventions).
 */
export function promptToGenAiMessages(
  messages: readonly ModelMessageView[] | undefined,
): ConvertedPrompt {
  if (!messages?.length) return { messages: [] };

  const out: GenAiMessage[] = [];
  const system: GenAiMessagePart[] = [];

  for (const message of messages) {
    const role = message.role ?? 'user';
    const parts = contentToParts(message.content);
    if (role === 'system') {
      system.push(...parts);
    } else {
      out.push({ role, parts });
    }
  }

  return system.length > 0
    ? { messages: out, systemInstructions: system }
    : { messages: out };
}

/**
 * Convert the `ContentPart[]` of a model response into a single GenAI output
 * message (always `assistant`), optionally tagged with a `finish_reason`.
 */
export function contentToGenAiMessage(
  content: readonly ContentPartView[] | undefined,
  finishReason?: string,
): GenAiMessage | undefined {
  if (!content?.length) return undefined;
  const message: GenAiMessage = {
    role: 'assistant',
    parts: content.flatMap((part) => partToGenAi(part)),
  };
  if (finishReason) message.finish_reason = finishReason;
  return message;
}

function contentToParts(
  content: string | readonly ContentPartView[] | undefined,
): GenAiMessagePart[] {
  if (content === undefined) return [];
  if (typeof content === 'string') {
    return content ? [{ type: 'text', content }] : [];
  }
  return content.flatMap((part) => partToGenAi(part));
}

/** Map one AI SDK content part to zero or more GenAI parts. */
function partToGenAi(part: ContentPartView): GenAiMessagePart[] {
  switch (part.type) {
    case 'text': {
      return part.text ? [{ type: 'text', content: part.text }] : [];
    }
    case 'reasoning': {
      return part.text ? [{ type: 'reasoning', content: part.text }] : [];
    }
    case 'tool-call': {
      return [
        {
          type: 'tool_call',
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.input,
        },
      ];
    }
    case 'tool-result': {
      return [
        {
          type: 'tool_call_response',
          id: part.toolCallId,
          response: part.output,
        },
      ];
    }
    case 'image':
    case 'file': {
      // Reference media by modality + mime type only — never inline bytes.
      return [
        {
          type: 'blob',
          modality: part.type === 'image' ? 'image' : 'file',
          mime_type: part.mediaType,
        },
      ];
    }
    default: {
      return part.type ? [{ type: part.type }] : [];
    }
  }
}

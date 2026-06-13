// Plain-language narration for an agent run. Each span becomes a step with a short role,
// a human title and a one-sentence explanation you can read aloud in a demo:
// "the model decides what to do", "a tool is real code the agent invoked",
// "the model synthesises the results into an answer".
//
// Pure functions over normalized spans so the copy is unit-tested and the
// Svelte layer stays a thin renderer.

import { summarizeToolCalls } from '../utils/genaiFormat'
import { MODEL_OPS } from './operations'
import type { GenAiSpan } from './types'

export interface NarrationStep {
  span: GenAiSpan
  /** Short kind label, e.g. "Model · planning", "Tool", "Agent". */
  role: string
  /** Human-readable step title. */
  title: string
  /** One-sentence, jargon-free explanation for a demo audience. */
  explain: string
}

/** A finish reason that means "the model asked to call a tool". Providers spell
 *  it differently (`tool_call`, `tool_calls`, `tool_use`, `function_call`). */
function isToolFinish(reason?: string): boolean {
  if (!reason) return false
  const r = reason.toLowerCase()
  return (
    r === 'tool_call' ||
    r === 'tool_calls' ||
    r === 'tool_use' ||
    r === 'function_call'
  )
}

/** True when this model call decided to call tools rather than answer. Checks
 *  structured tool calls first, then falls back to finish reasons — some
 *  providers (e.g. Ollama via Logfire) only signal the decision that way. */
function decidesTools(span: GenAiSpan): boolean {
  if (span.toolCalls.length > 0) return true
  if (span.messages.some((m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0))
    return true
  if (span.finishReasons?.some(isToolFinish)) return true
  return span.messages.some((m) => isToolFinish(m.finishReason))
}

function modelLabel(span: GenAiSpan): string {
  const model = span.responseModel ?? span.requestModel
  if (model && model !== 'unknown') return model
  return span.provider !== 'unknown' ? span.provider : 'model'
}

/** Describe a single span in plain language. */
export function explainSpan(span: GenAiSpan): Omit<NarrationStep, 'span'> {
  const op = span.operation

  if (op === 'invoke_agent' || op === 'create_agent') {
    const name = span.agent?.name ?? 'agent'
    return {
      role: 'Agent',
      title: `Agent: ${name}`,
      explain:
        'An agent orchestrates the work — it reads the goal, calls the model, runs tools, and decides what to do next.',
    }
  }

  if (op === 'execute_handoff' || span.handoff) {
    const from = span.handoff?.fromAgent ?? '?'
    const to = span.handoff?.toAgent ?? '?'
    return {
      role: 'Handoff',
      title: `Handoff: ${from} → ${to}`,
      explain: `Control passes from "${from}" to "${to}" — a specialised agent takes over for the next part of the task.`,
    }
  }

  if (op === 'execute_tool') {
    const name = span.tool?.name ?? span.agent?.name ?? span.name ?? 'tool'
    return {
      role: 'Tool',
      title: `Tool: ${name}`,
      explain:
        'A tool is real code the agent ran — the model chose the input, the function returned the output.',
    }
  }

  if (op === 'embeddings') {
    return {
      role: 'Embeddings',
      title: `Embeddings: ${modelLabel(span)}`,
      explain:
        'The text is turned into vectors so the agent can search or compare meaning, not just keywords.',
    }
  }

  if (op === 'speech' || op === 'transcription') {
    return {
      role: op === 'speech' ? 'Speech' : 'Transcription',
      title: `${op === 'speech' ? 'Text → speech' : 'Audio → text'}: ${modelLabel(span)}`,
      explain:
        op === 'speech'
          ? 'The model converts text into spoken audio.'
          : 'The model converts spoken audio into text the agent can read.',
    }
  }

  if (MODEL_OPS.has(op)) {
    if (decidesTools(span)) {
      // Name the tools when we know them ("Model calls getWeather (x3)");
      // otherwise stay generic — some providers only signal the decision via a
      // finish reason, with no structured tool calls on the span.
      const names = span.toolCalls.map((t) => t.name).filter(Boolean)
      const tools = summarizeToolCalls(names)
      return {
        role: 'Model · planning',
        title: tools.label ? `Model calls ${tools.label}` : 'Model decides what to do',
        explain:
          'The model reads the request, reasons about it, and decides which tools to call — it requests them, it does not run them yet.',
      }
    }
    return {
      role: 'Model · responding',
      title: 'Model writes the answer',
      explain:
        'The model takes everything gathered so far and synthesises it into the answer. This step often carries the most input, so it can be the most expensive.',
    }
  }

  return {
    role: op,
    title: span.name || op,
    explain: 'A step in the agent run.',
  }
}

/** Order spans into a chronological walkthrough and attach narration. The
 *  natural reading order of an agent run is the order things happened. */
export function buildTour(spans: GenAiSpan[]): NarrationStep[] {
  return [...spans]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((span) => ({ span, ...explainSpan(span) }))
}

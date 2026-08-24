import { describe, expect, it, beforeEach } from 'vitest';
import {
  SEQUENCE_RULES,
  detectSequences,
  spansToSequenceEvents,
  type SequenceSpanLike,
} from 'autotel-genai/agent';
import type { EdgeConfig, ReadableSpan } from 'autotel-edge';
import { createOtelObservability } from './otel-observability';
import type { ObservabilityEvent } from './types';

type SpanProcessor = Extract<
  NonNullable<EdgeConfig['spanProcessors']>,
  unknown[]
>[number];
type CapturingProcessor = SpanProcessor & { spans: ReadableSpan[] };

function createCapturingProcessor(): CapturingProcessor {
  return {
    spans: [],
    forceFlush: async () => undefined,
    onEnd(span) {
      this.spans.push(span);
    },
    onStart: () => undefined,
    shutdown: async () => undefined,
  };
}

function createObservabilityEvent<T extends ObservabilityEvent['type']>(
  type: T,
  payload: Extract<ObservabilityEvent, { type: T }>['payload'],
): Extract<ObservabilityEvent, { type: T }> {
  return { type, payload, timestamp: Date.now() } as Extract<
    ObservabilityEvent,
    { type: T }
  >;
}

describe('Cloudflare agent spans satisfy the shipped sequence rules', () => {
  // The previous test for this rule built canonical attributes by hand, so it
  // proved the rule matched a shape nobody emits. This drives the real
  // observability emitter and runs its actual spans through the adapter.
  const processor = createCapturingProcessor();

  beforeEach(() => {
    processor.spans.length = 0;
  });

  function detectFrom(spans: SequenceSpanLike[]) {
    return detectSequences(
      spansToSequenceEvents(spans, () => 'agent-session'),
      SEQUENCE_RULES,
    );
  }

  it('fires denied-then-executed when a denied tool call later succeeds', () => {
    const obs = createOtelObservability({
      service: { name: 'test-agent' },
      spanProcessors: [processor],
    });

    obs.emit(
      createObservabilityEvent('tool:approval', {
        toolCallId: 'tc-42',
        approved: false,
      }),
    );
    obs.emit(
      createObservabilityEvent('tool:result', {
        toolCallId: 'tc-42',
        toolName: 'shell',
      }),
    );

    const found = detectFrom(processor.spans as unknown as SequenceSpanLike[]);
    expect(found.map((d) => d.ruleId)).toContain('denied-then-executed');
  });

  it('does not fire when the denied call is not the one that ran', () => {
    const obs = createOtelObservability({
      service: { name: 'test-agent' },
      spanProcessors: [processor],
    });

    obs.emit(
      createObservabilityEvent('tool:approval', {
        toolCallId: 'tc-42',
        approved: false,
      }),
    );
    obs.emit(
      createObservabilityEvent('tool:result', {
        toolCallId: 'tc-99',
        toolName: 'shell',
      }),
    );

    expect(detectFrom(processor.spans as unknown as SequenceSpanLike[])).toEqual(
      [],
    );
  });

  it('does not fire when the human approved the call', () => {
    const obs = createOtelObservability({
      service: { name: 'test-agent' },
      spanProcessors: [processor],
    });

    obs.emit(
      createObservabilityEvent('tool:approval', {
        toolCallId: 'tc-42',
        approved: true,
      }),
    );
    obs.emit(
      createObservabilityEvent('tool:result', {
        toolCallId: 'tc-42',
        toolName: 'shell',
      }),
    );

    expect(detectFrom(processor.spans as unknown as SequenceSpanLike[])).toEqual(
      [],
    );
  });

  it('records a tool result in the canonical governance vocabulary', () => {
    const obs = createOtelObservability({
      service: { name: 'test-agent' },
      spanProcessors: [processor],
    });

    obs.emit(
      createObservabilityEvent('tool:result', {
        toolCallId: 'tc-1',
        toolName: 'shell',
      }),
    );

    expect(processor.spans[0]?.attributes).toMatchObject({
      'tool.name': 'shell',
      'tool.call.id': 'tc-1',
      'agent.outcome': 'success',
    });
  });
});

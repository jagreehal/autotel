import { context as otelContext, trace as otelTrace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGFUSE, langfuseCompatibility } from './index.js';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

/** Register the compatibility processor ahead of the exporting one. */
function setup(options: Parameters<typeof langfuseCompatibility>[0] = {}) {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [
      langfuseCompatibility(options),
      new SimpleSpanProcessor(exporter),
    ],
  });
  return provider.getTracer('langfuse-test');
}

afterEach(async () => {
  await provider?.shutdown();
});

const only = (): ReadableSpan => {
  const spans = exporter.getFinishedSpans();
  if (spans.length !== 1)
    throw new Error(`expected 1 span, got ${spans.length}`);
  return spans[0]!;
};

describe('langfuseCompatibility', () => {
  it('names the trace after the root span', () => {
    const tracer = setup();
    tracer.startSpan('invoke_agent support').end();
    expect(only().attributes[LANGFUSE.TRACE_NAME]).toBe('invoke_agent support');
  });

  it('takes a fixed trace name over the span name', () => {
    const tracer = setup({ traceName: 'support-chat' });
    tracer.startSpan('invoke_agent support').end();
    expect(only().attributes[LANGFUSE.TRACE_NAME]).toBe('support-chat');
  });

  it('takes a trace name derived from the span', () => {
    const tracer = setup({
      traceName: (span) => `${span.attributes['app.route']}`,
    });
    const span = tracer.startSpan('invoke_agent support');
    span.setAttribute('app.route', '/support');
    span.end();
    expect(only().attributes[LANGFUSE.TRACE_NAME]).toBe('/support');
  });

  it('leaves the trace unnamed when the resolver declines', () => {
    const tracer = setup({ traceName: () => undefined });
    tracer.startSpan('invoke_agent support').end();
    expect(only().attributes[LANGFUSE.TRACE_NAME]).toBeUndefined();
  });

  it('serialises tags as the JSON array Langfuse parses', () => {
    const tracer = setup({ tags: ['production', 'eu'] });
    tracer.startSpan('run').end();
    expect(only().attributes[LANGFUSE.TRACE_TAGS]).toBe('["production","eu"]');
  });

  it('converts time to first chunk into an absolute timestamp', () => {
    const tracer = setup();
    const startTime = new Date('2026-08-07T07:00:00.000Z');
    const span = tracer.startSpan('chat gpt-4o', { startTime });
    span.setAttribute('gen_ai.response.time_to_first_chunk', 0.25);
    span.end();
    expect(only().attributes[LANGFUSE.COMPLETION_START_TIME]).toBe(
      '2026-08-07T07:00:00.250Z',
    );
  });

  it('leaves completion start time alone for a non-streaming call', () => {
    const tracer = setup();
    tracer.startSpan('chat gpt-4o').end();
    expect(only().attributes[LANGFUSE.COMPLETION_START_TIME]).toBeUndefined();
  });

  it('applies release and version to every span, trace fields only to roots', () => {
    const tracer = setup({ release: 'abc123', version: '2.1.0', tags: ['x'] });
    const root = tracer.startSpan('run');
    const child = tracer.startSpan(
      'chat gpt-4o',
      undefined,
      otelTrace.setSpan(otelContext.active(), root),
    );
    child.end();
    root.end();

    const spans = exporter.getFinishedSpans();
    const childSpan = spans.find((s) => s.name === 'chat gpt-4o')!;
    const rootSpan = spans.find((s) => s.name === 'run')!;

    expect(childSpan.attributes[LANGFUSE.RELEASE]).toBe('abc123');
    expect(childSpan.attributes[LANGFUSE.VERSION]).toBe('2.1.0');
    expect(childSpan.attributes[LANGFUSE.TRACE_NAME]).toBeUndefined();
    expect(childSpan.attributes[LANGFUSE.TRACE_TAGS]).toBeUndefined();
    expect(rootSpan.attributes[LANGFUSE.TRACE_NAME]).toBe('run');
    expect(rootSpan.attributes[LANGFUSE.TRACE_TAGS]).toBe('["x"]');
  });

  it('never overwrites an attribute the application set itself', () => {
    const tracer = setup({ traceName: 'from-options' });
    const span = tracer.startSpan('run');
    span.setAttribute(LANGFUSE.TRACE_NAME, 'from-app');
    span.end();
    expect(only().attributes[LANGFUSE.TRACE_NAME]).toBe('from-app');
  });
});

describe('prompt linking', () => {
  it('links a managed prompt from the canonical attribute', () => {
    const tracer = setup();
    const span = tracer.startSpan('chat gpt-4o');
    span.setAttribute('gen_ai.prompt.name', 'support-router');
    span.setAttribute('gen_ai.prompt.version', 3);
    span.end();
    expect(only().attributes[LANGFUSE.PROMPT_NAME]).toBe('support-router');
    expect(only().attributes[LANGFUSE.PROMPT_VERSION]).toBe(3);
  });

  it('leaves the version out when the span does not carry one', () => {
    const tracer = setup();
    const span = tracer.startSpan('chat gpt-4o');
    span.setAttribute('gen_ai.prompt.name', 'support-router');
    span.end();
    expect(only().attributes[LANGFUSE.PROMPT_NAME]).toBe('support-router');
    expect(only().attributes[LANGFUSE.PROMPT_VERSION]).toBeUndefined();
  });

  it('removes the canonical attributes so Langfuse keeps input and output', () => {
    // Not tidiness. Langfuse reads anything under the `gen_ai.prompt` prefix as
    // the legacy prompt-content convention, and then takes input and output
    // from that convention alone: the observation's input becomes the prompt
    // name and version, and its output becomes empty. Verified against Langfuse
    // Cloud — leave these on the span and the messages never arrive.
    const tracer = setup();
    const span = tracer.startSpan('chat gpt-4o');
    span.setAttribute('gen_ai.prompt.name', 'support-router');
    span.setAttribute('gen_ai.prompt.version', 3);
    span.setAttribute('gen_ai.input.messages', '[{"role":"user"}]');
    span.end();

    const attributes = only().attributes;
    expect(attributes['gen_ai.prompt.name']).toBeUndefined();
    expect(attributes['gen_ai.prompt.version']).toBeUndefined();
    expect(attributes['gen_ai.input.messages']).toBe('[{"role":"user"}]');
  });

  it('keeps a prompt name the span mapped itself, and still clears the prefix', () => {
    const tracer = setup();
    const span = tracer.startSpan('chat gpt-4o');
    span.setAttribute('gen_ai.prompt.name', 'canonical');
    span.setAttribute(LANGFUSE.PROMPT_NAME, 'from-app');
    span.end();

    const attributes = only().attributes;
    expect(attributes[LANGFUSE.PROMPT_NAME]).toBe('from-app');
    expect(attributes['gen_ai.prompt.name']).toBeUndefined();
  });
});

describe('application values win over options', () => {
  it('keeps release, version and public that the span set itself', () => {
    // These options are process-wide defaults. A span that set the attribute
    // knows something the configuration does not, so it must not be clobbered.
    const tracer = setup({
      release: 'from-options',
      version: '1.0.0',
      public: false,
    });
    const span = tracer.startSpan('run');
    span.setAttribute(LANGFUSE.RELEASE, 'from-app');
    span.setAttribute(LANGFUSE.VERSION, '9.9.9');
    span.setAttribute(LANGFUSE.TRACE_PUBLIC, true);
    span.end();

    const attributes = only().attributes;
    expect(attributes[LANGFUSE.RELEASE]).toBe('from-app');
    expect(attributes[LANGFUSE.VERSION]).toBe('9.9.9');
    expect(attributes[LANGFUSE.TRACE_PUBLIC]).toBe(true);
  });

  it('still applies them when the span said nothing', () => {
    const tracer = setup({
      release: 'from-options',
      version: '1.0.0',
      public: true,
    });
    tracer.startSpan('run').end();
    const attributes = only().attributes;
    expect(attributes[LANGFUSE.RELEASE]).toBe('from-options');
    expect(attributes[LANGFUSE.VERSION]).toBe('1.0.0');
    expect(attributes[LANGFUSE.TRACE_PUBLIC]).toBe(true);
  });
});

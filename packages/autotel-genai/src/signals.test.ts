import { context, trace, type Attributes } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiSdkEvaluationAnswer } from './ai-sdk-evaluate.js';
import {
  createSignals,
  defineSignal,
  scriptedEvaluationModel,
  toVerdict,
  type SignalsOptions,
} from './signals.js';

const yes = (): AiSdkEvaluationAnswer => ({
  type: 'boolean',
  probability: 0.9,
});

const failed = defineSignal({
  name: 'silent_failure',
  when: (e) => e.status === 200,
  ask: 'Returned 200, but did the customer get what they came for?',
  keep: (v) => v.value && v.confidence > 0.8,
});

const fault = defineSignal({
  name: 'fault',
  when: (e) => e.status === 200,
  ask: 'Who is responsible?',
  choice: { client: 'Bad input', app: 'Our code', upstream: 'A dependency' },
});

const defaultModel = () =>
  scriptedEvaluationModel((_name, question) =>
    question.type === 'choice'
      ? { type: 'choice', choice: 'upstream', probabilities: { upstream: 0.7 } }
      : yes(),
  );

function setup(
  options: Omit<SignalsOptions, 'model'> & {
    model?: ReturnType<typeof defaultModel>;
  },
) {
  const model = options.model ?? defaultModel();
  const signals = createSignals({ ...options, model });
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [signals, new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  const tracer = provider.getTracer('test');
  const request = (attributes: Attributes, name = 'POST /checkout') => {
    const span = tracer.startSpan(name, { attributes });
    span.end();
    return span;
  };
  const spans = async () => {
    await signals.forceFlush();
    return exporter.getFinishedSpans();
  };
  return { signals, model, tracer, request, spans };
}

afterEach(() => trace.disable());

describe('defineSignal', () => {
  it('rejects bad definitions', () => {
    expect(() => defineSignal({ name: '1bad', ask: 'x' })).toThrow(
      /invalid name/,
    );
    expect(() => defineSignal({ name: 'ok', ask: ' ' })).toThrow(/empty ask/);
    expect(() =>
      defineSignal({ name: 'ok', ask: 'x', keep: () => true }),
    ).toThrow(/keep without when/);
    expect(() =>
      defineSignal({ name: 'ok', ask: 'x', choice: { only: 'one' } }),
    ).toThrow(/two options/);
    expect(() =>
      createSignals({
        model: scriptedEvaluationModel(yes),
        signals: [failed, failed],
      }),
    ).toThrow(/duplicate/);
  });

  it('maps answers to typed verdicts', () => {
    expect(toVerdict(failed, { type: 'boolean', probability: 0.2 })).toEqual({
      value: false,
      confidence: 0.8,
    });
    expect(
      toVerdict(fault, {
        type: 'choice',
        choice: 'app',
        probabilities: { app: 0.6 },
      }),
    ).toEqual({ value: 'app', confidence: 0.6 });
    const rubric = defineSignal({
      name: 'severity',
      ask: 'How bad?',
      score: ['low', 'mid', 'high'],
    });
    expect(
      toVerdict(rubric, {
        type: 'score',
        score: 1.7,
        probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
      }),
    ).toEqual({ value: 'high', score: 1.7, confidence: 0.7 });
  });
});

describe('createSignals', () => {
  it('asks every due signal in one call and records answers on a child span', async () => {
    const { model, request, spans } = setup({ signals: [failed, fault] });
    const root = request({ 'http.response.status_code': 200 });

    const all = await spans();
    expect(model.calls).toHaveLength(1);
    expect(Object.keys(model.calls[0]!.questions)).toEqual([
      'silent_failure',
      'fault',
    ]);
    const judged = all.find((s) => s.name === 'signals POST /checkout')!;
    expect(judged.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(judged.spanContext().traceId).toBe(root.spanContext().traceId);
    expect(judged.attributes).toMatchObject({
      'signals.silent_failure.value': true,
      'signals.silent_failure.confidence': 0.9,
      'signals.silent_failure.kept': true,
      'signals.fault.value': 'upstream',
      'signals.fault.confidence': 0.7,
      'signals.model': 'scripted',
    });
  });

  it('skips child spans and requests no signal is due for', async () => {
    const { model, tracer, request, spans } = setup({ signals: [failed] });
    request({ 'http.response.status_code': 500 });
    const parent = tracer.startSpan('GET /a', {
      attributes: { 'http.response.status_code': 404 },
    });
    tracer
      .startSpan(
        'db',
        { attributes: { 'http.response.status_code': 200 } },
        trace.setSpan(context.active(), parent),
      )
      .end();
    parent.end();
    await spans();
    expect(model.calls).toHaveLength(0);
  });

  it('redacts attributes before they reach the model', async () => {
    const { model, request, spans } = setup({ signals: [failed] });
    request({ 'http.response.status_code': 200, password: 'hunter2' });
    await spans();
    expect(JSON.stringify(model.calls[0]!.state)).not.toContain('hunter2');
  });

  it('skips requests once the budget is spent', async () => {
    const { signals, model, request, spans } = setup({
      signals: [failed],
      budget: { perMinute: 1 },
    });
    request({ 'http.response.status_code': 200 });
    request({ 'http.response.status_code': 200 });
    await spans();
    expect(model.calls).toHaveLength(1);
    expect(signals.stats()).toMatchObject({ calls: 1, skipped: 1 });
  });

  it('reuses cached verdicts on the request span itself, keep included', async () => {
    const cachedSignal = defineSignal({
      name: 'silent_failure',
      when: (e) => e.status === 200,
      ask: 'Did it fail silently?',
      keep: (v) => v.value,
      cacheKey: (e) => e.name,
    });
    const { signals, model, request, spans } = setup({
      signals: [cachedSignal],
    });
    request({ 'http.response.status_code': 200 });
    await spans();
    // Dropped by tail sampling until the cached verdict promotes it.
    const second = request({
      'http.response.status_code': 200,
      'autotel.sampling.tail.evaluated': true,
      'autotel.sampling.tail.keep': false,
    });
    const all = await spans();

    expect(model.calls).toHaveLength(1);
    expect(signals.stats().cached).toBe(1);
    const exported = all.find(
      (s) => s.spanContext().spanId === second.spanContext().spanId,
    )!;
    expect(exported.attributes).toMatchObject({
      'signals.silent_failure.value': true,
      'signals.silent_failure.kept': true,
      'autotel.sampling.tail.keep': true,
    });
  });

  it('carries the dropped request on the signals span when a fresh answer keeps it', async () => {
    const { request, spans } = setup({ signals: [failed] });
    request({
      'http.response.status_code': 200,
      'user.tier': 'pro',
      'autotel.sampling.tail.evaluated': true,
      'autotel.sampling.tail.keep': false,
    });
    const all = await spans();
    const judged = all.find((s) => s.name.startsWith('signals '))!;
    expect(judged.attributes).toMatchObject({
      'signals.silent_failure.kept': true,
      'signals.event.dropped': true,
      'signals.event.user.tier': 'pro',
      'signals.event.http.response.status_code': 200,
    });
  });

  it('times out, records the error, then pauses calls', async () => {
    const hanging = {
      provider: 'hang',
      modelId: 'hang',
      calls: [],
      doEvaluate: () => new Promise<never>(() => {}),
    };
    const { signals, request, spans } = setup({
      signals: [failed],
      model: hanging,
      timeoutMs: 10,
    });
    request({ 'http.response.status_code': 200 });
    const all = await spans();
    const judged = all.find((s) => s.name.startsWith('signals '))!;
    expect(judged.status.message).toMatch(/timed out/);
    request({ 'http.response.status_code': 200 });
    await spans();
    expect(signals.stats()).toMatchObject({ errors: 1, skipped: 1 });
  });

  it('counts a throwing or unserializable state projection as an error, never an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      for (const state of [
        () => {
          throw new Error('projection failed');
        },
        () => circular,
      ]) {
        const { signals, model, request, spans } = setup({
          signals: [failed],
          state,
        });
        request({ 'http.response.status_code': 200 });
        await spans();
        expect(model.calls).toHaveLength(0);
        expect(signals.stats()).toMatchObject({ errors: 1 });
        trace.disable();
      }
      // Unhandled rejections surface on a later turn.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it("keeps a throwing signal callback out of the app's span.end()", () => {
    const { signals, request } = setup({
      signals: [
        defineSignal({
          name: 'broken',
          when: () => {
            throw new Error('predicate failed');
          },
          ask: 'Unused',
        }),
      ],
    });
    expect(() => request({ 'http.response.status_code': 200 })).not.toThrow();
    expect(signals.stats()).toMatchObject({ errors: 1 });
  });

  it('ignores a choice the signal does not offer', async () => {
    const { request, spans } = setup({
      signals: [fault],
      model: scriptedEvaluationModel(() => ({
        type: 'choice',
        choice: 'aliens',
      })),
    });
    request({ 'http.response.status_code': 200 });
    const all = await spans();
    const judged = all.find((s) => s.name.startsWith('signals '))!;
    expect(judged.attributes['signals.fault.value']).toBeUndefined();
  });

  it('skips only the signal whose keep throws, without pausing calls', async () => {
    const { signals, request, spans } = setup({
      signals: [
        defineSignal({
          name: 'odd',
          when: () => true,
          ask: 'Odd?',
          keep: () => {
            throw new Error('keep failed');
          },
        }),
      ],
    });
    request({});
    await spans();
    request({});
    await spans();
    expect(signals.stats()).toMatchObject({ calls: 2, errors: 2, skipped: 0 });
  });

  it('waits on shutdown for calls that start while it drains', async () => {
    let requests = 0;
    const model = {
      provider: 'slow',
      modelId: 'slow',
      calls: [],
      doEvaluate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (++requests === 1) request({ 'http.response.status_code': 200 });
        return { answers: { silent_failure: yes() } };
      },
    };
    const { signals, request } = setup({ signals: [failed], model });
    request({ 'http.response.status_code': 200 });
    await signals.shutdown();
    expect(signals.stats()).toMatchObject({ calls: 2 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const traceCalls: { name: unknown }[] = [];
const fakeCtx = {
  setAttributes: vi.fn(),
  setAttribute: vi.fn(),
  track: vi.fn(),
};

vi.mock('autotel', () => ({
  withTracing:
    (options: { name: unknown }) => (factory: (ctx: unknown) => unknown) => {
      traceCalls.push({ name: options.name });
      return (...args: unknown[]) =>
        (factory(fakeCtx) as (...a: unknown[]) => unknown)(...args);
    },
}));

vi.mock('./metrics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./metrics.js')>()),
  recordGenAiMetrics: () => {},
}));

const { wrapEvaluationModel, evaluationScore } =
  await import('./ai-sdk-evaluate.js');

const jevResult = {
  answers: {
    urgent: { type: 'boolean' as const, probability: 0.97 },
    team: {
      type: 'choice' as const,
      choice: 'engineering',
      probabilities: { engineering: 0.94, billing: 0.04, sales: 0.02 },
    },
    frustration: { type: 'score' as const, score: 1.4 },
  },
  usage: { inputTokens: 540, outputTokens: 94 },
  response: { id: 'resp_1', modelId: 'jev-2026-09' },
  warnings: [],
};

function fakeModel() {
  return {
    specificationVersion: 'v4' as const,
    provider: 'typesafe-ai.evaluation',
    modelId: 'jev-latest',
    supportedQuestionTypes: ['choice', 'score', 'boolean'] as const,
    doEvaluate: vi.fn(
      async (_options: { state: unknown; questions: unknown }) => jevResult,
    ),
  };
}

beforeEach(() => {
  traceCalls.length = 0;
  fakeCtx.setAttributes.mockClear();
  fakeCtx.setAttribute.mockClear();
  fakeCtx.track.mockClear();
});

describe('evaluationScore', () => {
  it('maps each answer type to a score value and label', () => {
    expect(evaluationScore(jevResult.answers.team)).toEqual({
      scoreLabel: 'engineering',
      scoreValue: 0.94,
    });
    expect(evaluationScore(jevResult.answers.frustration)).toEqual({
      scoreValue: 1.4,
    });
    expect(evaluationScore(jevResult.answers.urgent)).toEqual({
      scoreValue: 0.97,
    });
    expect(evaluationScore({ type: 'choice', choice: 'x' })).toEqual({
      scoreLabel: 'x',
      scoreValue: undefined,
    });
  });
});

describe('wrapEvaluationModel', () => {
  it('keeps the model contract and passes the call through unchanged', async () => {
    const model = fakeModel();
    const wrapped = wrapEvaluationModel(model);
    const call = { state: { ticket: 'deploy failed' }, questions: {} };

    const result = await wrapped.doEvaluate(call);

    expect(result).toBe(jevResult);
    expect(model.doEvaluate).toHaveBeenCalledWith(call);
    expect(wrapped.provider).toBe('typesafe-ai.evaluation');
    expect(wrapped.modelId).toBe('jev-latest');
    expect(wrapped.specificationVersion).toBe('v4');
    expect(wrapped.supportedQuestionTypes).toEqual([
      'choice',
      'score',
      'boolean',
    ]);
  });

  it('opens an `evaluate {model}` span with gen_ai request, response and usage attributes', async () => {
    await wrapEvaluationModel(fakeModel(), {
      cost: { recordCost: false },
    }).doEvaluate({ state: 's', questions: {} });

    expect(traceCalls[0]?.name).toBe('evaluate jev-latest');
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.operation.name': 'evaluate',
        'gen_ai.provider.name': 'typesafe-ai.evaluation',
        'gen_ai.request.model': 'jev-latest',
      }),
    );
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.response.model': 'jev-2026-09',
        'gen_ai.response.id': 'resp_1',
      }),
    );
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'gen_ai.usage.input_tokens': 540,
        'gen_ai.usage.output_tokens': 94,
      }),
    );
  });

  it('emits one gen_ai.evaluation.result event per answer', async () => {
    await wrapEvaluationModel(fakeModel(), {
      cost: { recordCost: false },
    }).doEvaluate({ state: 's', questions: {} });

    const events = fakeCtx.track.mock.calls
      .filter(([name]) => name === 'gen_ai.evaluation.result')
      .map(([, data]) => data);
    expect(events).toEqual([
      expect.objectContaining({
        'gen_ai.evaluation.name': 'urgent',
        'gen_ai.evaluation.score.value': 0.97,
        'gen_ai.response.id': 'resp_1',
      }),
      expect.objectContaining({
        'gen_ai.evaluation.name': 'team',
        'gen_ai.evaluation.score.label': 'engineering',
        'gen_ai.evaluation.score.value': 0.94,
      }),
      expect.objectContaining({
        'gen_ai.evaluation.name': 'frustration',
        'gen_ai.evaluation.score.value': 1.4,
      }),
    ]);
  });

  it('prices usage through the cost table when the model is known', async () => {
    const model = { ...fakeModel(), modelId: 'gpt-4o' };
    await wrapEvaluationModel(model).doEvaluate({ state: 's', questions: {} });
    expect(fakeCtx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'gen_ai.usage.cost.usd': expect.any(Number) }),
    );
  });

  it('marks the span with error.type and rethrows when evaluation fails', async () => {
    const model = fakeModel();
    model.doEvaluate.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { name: 'AI_APICallError' }),
    );
    await expect(
      wrapEvaluationModel(model).doEvaluate({ state: 's', questions: {} }),
    ).rejects.toThrow('boom');
    expect(fakeCtx.setAttribute).toHaveBeenCalledWith(
      'error.type',
      'AI_APICallError',
    );
    expect(fakeCtx.track).not.toHaveBeenCalled();
  });
});

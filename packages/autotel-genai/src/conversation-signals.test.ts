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

const {
  CONVERSATION_SIGNAL_NAMES,
  CONVERSATION_SIGNAL_QUESTIONS,
  DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS,
  conversationSignalResults,
  conversationSignalState,
  runConversationSignals,
} = await import('./conversation-signals.js');

const plantedAnswers = {
  user_frustrated: { type: 'boolean' as const, probability: 0.82 },
  user_follow_up: { type: 'boolean' as const, probability: 0.91 },
  user_disagrees: { type: 'boolean' as const, probability: 0.12 },
  outcome_resolved: { type: 'boolean' as const, probability: 0.88 },
  agent_corrected: { type: 'boolean' as const, probability: 0.75 },
};

function fakeModel(
  answers: Record<
    string,
    { type: 'boolean'; probability: number }
  > = plantedAnswers,
) {
  return {
    provider: 'typesafe-ai.evaluation',
    modelId: 'jev-1.13.0',
    doEvaluate: vi.fn(
      async (_options: { state: unknown; questions: unknown }) => ({
        answers,
        usage: { inputTokens: 200, outputTokens: 40 },
        response: { id: 'eval_1', modelId: 'jev-1.13.0' },
      }),
    ),
  };
}

beforeEach(() => {
  traceCalls.length = 0;
  fakeCtx.setAttributes.mockClear();
  fakeCtx.setAttribute.mockClear();
  fakeCtx.track.mockClear();
});

describe('CONVERSATION_SIGNAL_QUESTIONS', () => {
  it('defines a boolean question with criteria for every signal name', () => {
    expect(Object.keys(CONVERSATION_SIGNAL_QUESTIONS).sort()).toEqual(
      [...CONVERSATION_SIGNAL_NAMES].sort(),
    );
    expect(Object.keys(DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS).sort()).toEqual(
      [...CONVERSATION_SIGNAL_NAMES].sort(),
    );
    for (const name of CONVERSATION_SIGNAL_NAMES) {
      const question = CONVERSATION_SIGNAL_QUESTIONS[name];
      expect(question.type).toBe('boolean');
      expect(question.instructions.length).toBeGreaterThan(0);
      expect(question.criteria.true.length).toBeGreaterThan(0);
      expect(question.criteria.false.length).toBeGreaterThan(0);
      expect(DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS[name]).toBe(0.7);
    }
  });
});

describe('conversationSignalState', () => {
  it('keeps turn order and roles as named JSON, not a string blob', () => {
    const state = conversationSignalState({
      turns: [
        { role: 'user', text: 'Rebook my flight' },
        { role: 'assistant', text: 'I cancelled it' },
        { role: 'user', text: 'No — rebook, not cancel' },
      ],
    });
    expect(state).toEqual({
      turns: [
        { role: 'user', text: 'Rebook my flight' },
        { role: 'assistant', text: 'I cancelled it' },
        { role: 'user', text: 'No — rebook, not cancel' },
      ],
    });
    expect(typeof state).toBe('object');
  });
});

describe('conversationSignalResults', () => {
  it('labels at the threshold boundary', () => {
    expect(
      conversationSignalResults(
        { user_frustrated: { type: 'boolean', probability: 0.69 } },
        { user_frustrated: 0.7 },
      ),
    ).toEqual([
      { name: 'user_frustrated', scoreValue: 0.69, scoreLabel: 'no' },
    ]);
    expect(
      conversationSignalResults(
        { user_frustrated: { type: 'boolean', probability: 0.7 } },
        { user_frustrated: 0.7 },
      ),
    ).toEqual([
      { name: 'user_frustrated', scoreValue: 0.7, scoreLabel: 'yes' },
    ]);
  });

  it('skips non-boolean answers and unknown keys', () => {
    expect(
      conversationSignalResults({
        user_frustrated: {
          type: 'choice',
          choice: 'high',
          probabilities: { high: 0.9 },
        },
        other: { type: 'boolean', probability: 0.99 },
      }),
    ).toEqual([]);
  });
});

describe('runConversationSignals', () => {
  it('evaluates the pack, records labeled events, and returns verdicts', async () => {
    const model = fakeModel();
    const { results } = await runConversationSignals(
      model,
      {
        turns: [
          { role: 'user', text: 'Rebook my flight to Tuesday' },
          { role: 'assistant', text: 'Cancelled. Anything else?' },
          { role: 'user', text: 'I said rebook. Please fix this.' },
          {
            role: 'assistant',
            text: 'Rebooked for Tuesday. Confirmation sent.',
          },
        ],
      },
      { cost: { recordCost: false } },
    );

    expect(traceCalls[0]?.name).toBe('evaluate jev-1.13.0');
    expect(model.doEvaluate).toHaveBeenCalledWith({
      state: {
        turns: [
          { role: 'user', text: 'Rebook my flight to Tuesday' },
          { role: 'assistant', text: 'Cancelled. Anything else?' },
          { role: 'user', text: 'I said rebook. Please fix this.' },
          {
            role: 'assistant',
            text: 'Rebooked for Tuesday. Confirmation sent.',
          },
        ],
      },
      questions: CONVERSATION_SIGNAL_QUESTIONS,
    });

    const events = fakeCtx.track.mock.calls
      .filter(([name]) => name === 'gen_ai.evaluation.result')
      .map(([, data]) => data);
    expect(events).toHaveLength(CONVERSATION_SIGNAL_NAMES.length);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          'gen_ai.evaluation.name': 'user_frustrated',
          'gen_ai.evaluation.score.value': 0.82,
          'gen_ai.evaluation.score.label': 'yes',
        }),
        expect.objectContaining({
          'gen_ai.evaluation.name': 'user_disagrees',
          'gen_ai.evaluation.score.value': 0.12,
          'gen_ai.evaluation.score.label': 'no',
        }),
        expect.objectContaining({
          'gen_ai.evaluation.name': 'outcome_resolved',
          'gen_ai.evaluation.score.value': 0.88,
          'gen_ai.evaluation.score.label': 'yes',
        }),
      ]),
    );

    expect(results).toEqual([
      { name: 'user_frustrated', scoreValue: 0.82, scoreLabel: 'yes' },
      { name: 'user_follow_up', scoreValue: 0.91, scoreLabel: 'yes' },
      { name: 'user_disagrees', scoreValue: 0.12, scoreLabel: 'no' },
      { name: 'outcome_resolved', scoreValue: 0.88, scoreLabel: 'yes' },
      { name: 'agent_corrected', scoreValue: 0.75, scoreLabel: 'yes' },
    ]);
  });
});

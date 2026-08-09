import { describe, expect, it, vi } from 'vitest';
import {
  GEN_AI_EVALUATION_RESULT,
  langfuseScores,
  toScorePayload,
} from './scores.js';

const evaluation = (extra: Record<string, unknown> = {}) => ({
  traceId: 'trace-1',
  spanId: 'span-1',
  'gen_ai.evaluation.name': 'faithfulness',
  ...extra,
});

describe('toScorePayload', () => {
  it('maps a numeric evaluation', () => {
    expect(
      toScorePayload(evaluation({ 'gen_ai.evaluation.score.value': 0.92 })),
    ).toEqual({
      traceId: 'trace-1',
      name: 'faithfulness',
      value: 0.92,
      dataType: 'NUMERIC',
    });
  });

  it('falls back to the label as a categorical score', () => {
    expect(
      toScorePayload(evaluation({ 'gen_ai.evaluation.score.label': 'pass' })),
    ).toEqual({
      traceId: 'trace-1',
      name: 'faithfulness',
      value: 'pass',
      dataType: 'CATEGORICAL',
    });
  });

  it('prefers the numeric value when both are present', () => {
    // Langfuse charts numerics and only groups categoricals, so a run that
    // reports both is more useful as a number.
    const payload = toScorePayload(
      evaluation({
        'gen_ai.evaluation.score.value': 0.4,
        'gen_ai.evaluation.score.label': 'fail',
      }),
    );
    expect(payload).toMatchObject({ value: 0.4, dataType: 'NUMERIC' });
  });

  it('carries the explanation as the score comment', () => {
    const payload = toScorePayload(
      evaluation({
        'gen_ai.evaluation.score.value': 1,
        'gen_ai.evaluation.explanation': 'every claim is supported',
      }),
    );
    expect(payload?.comment).toBe('every claim is supported');
  });

  it('scores the observation when asked to', () => {
    const payload = toScorePayload(
      evaluation({ 'gen_ai.evaluation.score.value': 1 }),
      { scoreObservation: true },
    );
    expect(payload?.observationId).toBe('span-1');
  });

  it('returns nothing without a trace id, a name, or any score', () => {
    expect(
      toScorePayload({
        'gen_ai.evaluation.name': 'x',
        'gen_ai.evaluation.score.value': 1,
      }),
    ).toBeUndefined();
    expect(
      toScorePayload(
        evaluation({
          'gen_ai.evaluation.score.value': 1,
          'gen_ai.evaluation.name': '',
        }),
      ),
    ).toBeUndefined();
    expect(toScorePayload(evaluation())).toBeUndefined();
  });

  it('rejects a non-finite score rather than sending NaN', () => {
    expect(
      toScorePayload(
        evaluation({ 'gen_ai.evaluation.score.value': Number.NaN }),
      ),
    ).toBeUndefined();
  });
});

describe('langfuseScores', () => {
  const options = {
    baseUrl: 'http://langfuse.test/',
    publicKey: 'pk',
    secretKey: 'sk',
  };

  it('posts the score with basic auth to the scores endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock as never,
    });

    await subscriber.trackEvent(
      GEN_AI_EVALUATION_RESULT,
      evaluation({ 'gen_ai.evaluation.score.value': 0.92 }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    // The trailing slash on baseUrl must not become a double slash.
    expect(url).toBe('http://langfuse.test/api/public/scores');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('pk:sk').toString('base64')}`,
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      traceId: 'trace-1',
      name: 'faithfulness',
      value: 0.92,
    });
  });

  it('uses the subscriber trace context when ids are not copied into attributes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const subscriber = langfuseScores({
      ...options,
      scoreObservation: true,
      fetch: fetchMock as never,
    });

    await subscriber.trackEvent(
      GEN_AI_EVALUATION_RESULT,
      {
        'gen_ai.evaluation.name': 'faithfulness',
        'gen_ai.evaluation.score.value': 0.92,
      },
      {
        autotel: {
          correlation_id: 'correlation-1',
          trace_id: 'trace-from-context',
          span_id: 'span-from-context',
        },
      },
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      traceId: 'trace-from-context',
      observationId: 'span-from-context',
    });
  });

  it('ignores every other event', async () => {
    const fetchMock = vi.fn();
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock as never,
    });
    await subscriber.trackEvent('order.created', { traceId: 'trace-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected score without throwing into the run', async () => {
    // A score that fails to post must never take down the operation that
    // produced it.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
    const onError = vi.fn();
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock as never,
      onError,
    });

    await expect(
      subscriber.trackEvent(
        GEN_AI_EVALUATION_RESULT,
        evaluation({ 'gen_ai.evaluation.score.value': 1 }),
      ),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].message).toContain('401');
  });

  it('reports a transport failure the same way', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const onError = vi.fn();
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock as never,
      onError,
    });

    await subscriber.trackEvent(
      GEN_AI_EVALUATION_RESULT,
      evaluation({ 'gen_ai.evaluation.score.value': 1 }),
    );
    expect(onError.mock.calls[0]![0].message).toBe('ECONNREFUSED');
  });
});

describe('error isolation', () => {
  const options = {
    baseUrl: 'http://langfuse.test',
    publicKey: 'pk',
    secretKey: 'sk',
  };
  const numeric = {
    traceId: 'trace-1',
    'gen_ai.evaluation.name': 'faithfulness',
    'gen_ai.evaluation.score.value': 1,
  };

  it('reports a rejected response exactly once', async () => {
    // The reporting call used to sit inside the try that caught it, so an
    // onError that threw was invoked a second time from the catch.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    });
    const onError = vi.fn(() => {
      throw new Error('reporter exploded');
    });
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock as never,
      onError,
    });

    await subscriber.trackEvent(GEN_AI_EVALUATION_RESULT, numeric);

    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not reject when the error callback itself throws', async () => {
    // A rejected trackEvent would reach the event queue's retry path, which is
    // exactly the interference this bridge promises never to cause.
    const onError = vi.fn(() => {
      throw new Error('reporter exploded');
    });

    const failedResponse = langfuseScores({
      ...options,
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'no',
      }) as never,
      onError,
    });
    const failedTransport = langfuseScores({
      ...options,
      fetch: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never,
      onError,
    });

    await expect(
      failedResponse.trackEvent(GEN_AI_EVALUATION_RESULT, numeric),
    ).resolves.toBeUndefined();
    await expect(
      failedTransport.trackEvent(GEN_AI_EVALUATION_RESULT, numeric),
    ).resolves.toBeUndefined();
  });
});

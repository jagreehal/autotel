import { describe, expect, it, vi } from 'vitest';
import type { Attributes } from '@opentelemetry/api';
import {
  GEN_AI_EVALUATION_RESULT,
  langfuseScores,
  toScorePayload,
} from './scores.js';

/**
 * A fetch stand-in that answers with a real Response and records the calls, so
 * `ok` follows from the status the way it does in production.
 */
function fakeFetch(response: { status: number; statusText?: string }) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(null, response));
}

/** A fetch stand-in that rejects, for the transport-failure paths. */
function failingFetch(cause: Error) {
  return vi.fn<typeof fetch>().mockRejectedValue(cause);
}

/** The url and init of a recorded fetch call, with the body already parsed. */
function callOf(fetchStub: typeof fetch, index = 0) {
  const calls = vi.mocked(fetchStub).mock.calls;
  const [url, init] = calls[index]!;
  const request = init ?? {};
  return {
    url: String(url),
    headers: request.headers,
    body: JSON.parse(String(request.body ?? '{}')),
  };
}

const evaluation = (extra: Attributes = {}) => ({
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
    const fetchMock = fakeFetch({ status: 200 });
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock,
    });

    await subscriber.trackEvent(
      GEN_AI_EVALUATION_RESULT,
      evaluation({ 'gen_ai.evaluation.score.value': 0.92 }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = callOf(fetchMock);
    // The trailing slash on baseUrl must not become a double slash.
    expect(call.url).toBe('http://langfuse.test/api/public/scores');
    expect(call.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('pk:sk').toString('base64')}`,
    });
    expect(call.body).toMatchObject({
      traceId: 'trace-1',
      name: 'faithfulness',
      value: 0.92,
    });
  });

  it('uses the subscriber trace context when ids are not copied into attributes', async () => {
    const fetchMock = fakeFetch({ status: 200 });
    const subscriber = langfuseScores({
      ...options,
      scoreObservation: true,
      fetch: fetchMock,
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

    const call = callOf(fetchMock);
    expect(call.body).toMatchObject({
      traceId: 'trace-from-context',
      observationId: 'span-from-context',
    });
  });

  it('ignores every other event', async () => {
    const fetchMock = vi.fn();
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock,
    });
    await subscriber.trackEvent('order.created', { traceId: 'trace-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected score without throwing into the run', async () => {
    // A score that fails to post must never take down the operation that
    // produced it.
    const fetchMock = fakeFetch({ status: 401, statusText: 'Unauthorized' });
    const onError = vi.fn();
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock,
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
      fetch: fetchMock,
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
    const fetchMock = fakeFetch({ status: 500, statusText: 'Server Error' });
    const onError = vi.fn(() => {
      throw new Error('reporter exploded');
    });
    const subscriber = langfuseScores({
      ...options,
      fetch: fetchMock,
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
      fetch: fakeFetch({ status: 401, statusText: 'no' }),
      onError,
    });
    const failedTransport = langfuseScores({
      ...options,
      fetch: failingFetch(new Error('ECONNREFUSED')),
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

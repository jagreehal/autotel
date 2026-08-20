/**
 * Evaluation results as Langfuse scores.
 *
 * Scores are the one part of Langfuse that OTLP cannot carry. Traces go to
 * `/api/public/otel`, and scores go to `/api/public/scores`, a documented public
 * endpoint taking the same Basic auth as the OTLP one. So this bridge speaks
 * that wire API directly rather than depending on `@langfuse/client`, for the
 * same reason the trace path depends on no Langfuse package: a wire contract
 * that a contract test can hold to is a smaller thing to keep in step than an
 * SDK's release cadence.
 *
 * `autotel-genai` already emits an evaluation event, and autotel already stamps
 * every event with the trace and span it happened in. That is exactly what a
 * score needs, so the bridge is a subscriber:
 *
 * @example
 * ```ts
 * import { init } from 'autotel';
 * import { langfuseScores } from 'autotel-langfuse';
 *
 * init({
 *   service: 'support-agent',
 *   destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
 *   subscribers: [langfuseScores({ baseUrl, publicKey, secretKey })],
 * });
 * ```
 *
 * Then anything that records an evaluation lands as a score against the run
 * that produced it:
 *
 * ```ts
 * import { recordEvaluationResult } from 'autotel-genai/events';
 *
 * recordEvaluationResult(ctx, { name: 'faithfulness', scoreValue: 0.92 });
 * ```
 */

import type { AttributeValue, Attributes } from '@opentelemetry/api';

/** The event `autotel-genai` emits for an evaluation result. */
export const GEN_AI_EVALUATION_RESULT = 'gen_ai.evaluation.result';

const EVALUATION = {
  NAME: 'gen_ai.evaluation.name',
  SCORE_VALUE: 'gen_ai.evaluation.score.value',
  SCORE_LABEL: 'gen_ai.evaluation.score.label',
  EXPLANATION: 'gen_ai.evaluation.explanation',
} as const;

export interface LangfuseScoresOptions {
  /** Langfuse base URL, e.g. `https://cloud.langfuse.com`. */
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  /**
   * Attach the score to the span the evaluation happened in, rather than to the
   * trace as a whole. Off by default: an evaluation usually judges the run.
   */
  scoreObservation?: boolean;
  /**
   * Called when Langfuse rejects a score or the request fails. Defaults to a
   * warning on the console. A failed score must never take down the run that
   * produced it, so this never throws.
   */
  onError?: (error: Error) => void;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** The subset of the score payload this bridge sends. */
interface ScorePayload {
  traceId: string;
  observationId?: string;
  name: string;
  value: number | string;
  dataType: 'NUMERIC' | 'CATEGORICAL';
  comment?: string;
}

/** The trace context shape Autotel passes to every event subscriber. */
interface SubscriberTrackingOptions {
  autotel?: {
    trace_id?: string;
    span_id?: string;
    /** Autotel adds more here (correlation id, service, session); unread by us. */
    correlation_id?: string;
    service?: string;
    session_id?: string;
  };
}

const asString = (value: AttributeValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Turn an evaluation event into the score Langfuse stores, or `undefined` when
 * the event cannot become one. A numeric value wins over a label, because
 * Langfuse charts numerics and only groups categoricals.
 */
export function toScorePayload(
  attributes: Attributes,
  options: { scoreObservation?: boolean } = {},
): ScorePayload | undefined {
  const traceId = asString(attributes.traceId);
  const name = asString(attributes[EVALUATION.NAME]);
  if (!traceId || !name) return undefined;

  const rawValue = attributes[EVALUATION.SCORE_VALUE];
  const label = asString(attributes[EVALUATION.SCORE_LABEL]);
  const numericValue =
    typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? rawValue
      : undefined;
  if (numericValue === undefined && label === undefined) return undefined;

  // Langfuse charts numerics and only groups categoricals, so a numeric score
  // is preferred whenever the event carried one.
  const scored: Pick<ScorePayload, 'value' | 'dataType'> =
    numericValue === undefined
      ? { value: label!, dataType: 'CATEGORICAL' }
      : { value: numericValue, dataType: 'NUMERIC' };

  const payload: ScorePayload = { traceId, name, ...scored };

  const observationId = options.scoreObservation
    ? asString(attributes.spanId)
    : undefined;
  if (observationId !== undefined) payload.observationId = observationId;

  const explanation = asString(attributes[EVALUATION.EXPLANATION]);
  if (explanation !== undefined) payload.comment = explanation;

  return payload;
}

/**
 * An autotel event subscriber that forwards evaluation results to Langfuse as
 * scores. Every other event passes through untouched.
 */
export function langfuseScores(options: LangfuseScoresOptions) {
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/api/public/scores`;
  const authorization = `Basic ${Buffer.from(
    `${options.publicKey}:${options.secretKey}`,
  ).toString('base64')}`;
  const doFetch = options.fetch ?? globalThis.fetch;
  const onError =
    options.onError ??
    ((error: Error) =>
      console.warn('[autotel-langfuse] score failed:', error.message));

  /**
   * The only place `onError` is called, and it swallows whatever the callback
   * does. A reporting callback that throws must not become a rejected
   * `trackEvent`, which the event queue would treat as work to retry: the whole
   * promise of this bridge is that a score never disturbs the run that produced
   * it, and an error path that can itself fail is not that promise.
   */
  const report = (error: Error): void => {
    try {
      onError(error);
    } catch {
      // Nothing left to escalate to.
    }
  };

  const noop = async (): Promise<void> => {};

  return {
    name: 'langfuse-scores',

    async trackEvent(
      name: string,
      attributes: Attributes = {},
      tracking?: SubscriberTrackingOptions,
    ): Promise<void> {
      if (name !== GEN_AI_EVALUATION_RESULT) return;
      const payload = toScorePayload(
        {
          traceId: tracking?.autotel?.trace_id,
          spanId: tracking?.autotel?.span_id,
          ...attributes,
        },
        {
          scoreObservation: options.scoreObservation,
        },
      );
      if (!payload) return;

      // The request is the only thing inside the try. Reporting sits outside
      // it, so a rejected response cannot report once from the try and then
      // again from the catch.
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        report(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!response.ok) {
        report(
          new Error(
            `${response.status} ${response.statusText} from ${endpoint}`,
          ),
        );
      }
    },

    trackFunnelStep: noop,
    trackOutcome: noop,
    trackValue: noop,
    identify: noop,
    flush: noop,
    shutdown: noop,
  };
}

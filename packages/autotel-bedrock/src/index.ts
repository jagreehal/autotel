/**
 * Amazon Bedrock compatibility.
 *
 * Bedrock is a *provider*, not a destination, and `autotel-genai` already
 * emits canonical `gen_ai.*` spans for every AI SDK call against it:
 * `gen_ai.provider.name = aws.bedrock`, the model id as requested, token
 * usage, input/output messages. Nothing here is required for that.
 *
 * What this module adds is the handful of Bedrock facts no OpenTelemetry
 * convention covers and no generic price table knows:
 *
 *   - **One model, three spellings.** Bedrock accepts a foundation-model id,
 *     a cross-region inference-profile id (`eu.` / `us.` / `global.` prefix)
 *     and a full inference-profile ARN for the same model. Dashboards group
 *     by `gen_ai.request.model`, and Datadog / Langfuse price by it, so an
 *     ARN or a profile prefix splits one model into several rows and drops
 *     the cost. The enricher rewrites the model attributes to the foundation
 *     id and keeps the profile region and ARN as their own attributes.
 *   - **Where it ran.** `cloud.provider` / `cloud.region`, from the option
 *     or `AWS_REGION`, so a multi-region deployment can be split by region.
 *   - **Bedrock-only pricing.** {@link BEDROCK_PRICING} covers the models
 *     that exist only behind Bedrock — Nova, Llama, Mistral, DeepSeek, GLM —
 *     for `autotelTelemetry({ pricing })`. Anthropic models are priced by
 *     `autotel-genai` already, at the same rates Bedrock charges.
 *
 * @example
 * ```ts
 * import { init } from 'autotel';
 * import { registerTelemetry } from 'ai';
 * import { autotelTelemetry } from 'autotel-genai/observer';
 * import { bedrockCompatibility, BEDROCK_PRICING } from 'autotel-bedrock';
 *
 * init({
 *   service: 'payments-bot',
 *   spanEnrichers: [bedrockCompatibility({ region: 'eu-west-1' })],
 * });
 * registerTelemetry(autotelTelemetry({ pricing: BEDROCK_PRICING }));
 * ```
 */

import type { Attributes } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { JsonValue, ProviderResponseView } from 'autotel-genai/observer';
import { parseBedrockModelId } from './model-id.js';

/**
 * Canonical attributes this processor reads. Spelled out rather than imported
 * from `autotel-genai` so the package has no dependency beyond the OTel API.
 */
const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
const GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
const CLOUD_PROVIDER = 'cloud.provider';
const CLOUD_REGION = 'cloud.region';

/** The `gen_ai.provider.name` value the semantic conventions assign Bedrock. */
export const AWS_BEDROCK_PROVIDER = 'aws.bedrock';

/** Bedrock facts with no `gen_ai.*` equivalent. */
export const AWS_BEDROCK = {
  /** The model identifier exactly as the request named it, before normalisation. */
  MODEL_ID_RAW: 'aws.bedrock.model.id_raw',
  /** Inference-profile ARN, when the request used one. */
  MODEL_ARN: 'aws.bedrock.model.arn',
  /** Region group of a cross-region inference profile: `eu`, `us`, `global`… */
  INFERENCE_PROFILE_REGION: 'aws.bedrock.inference_profile.region',
  /** Vendor segment of the foundation model id: `anthropic`, `amazon`, `meta`… */
  MODEL_VENDOR: 'aws.bedrock.model.vendor',
  /**
   * Bedrock's own stop reason (`end_turn`, `max_tokens`, `guardrail_intervened`,
   * `malformed_tool_use`…). `gen_ai.response.finish_reasons` keeps the AI SDK's
   * unified value, which folds several of these together.
   */
  STOP_REASON: 'aws.bedrock.stop_reason',
  /** Canonical: the guardrail that assessed the call, from its trace. */
  GUARDRAIL_ID: 'aws.bedrock.guardrail.id',
  /** Whether the guardrail stopped generation. A policy outcome, not an error. */
  GUARDRAIL_INTERVENED: 'aws.bedrock.guardrail.intervened',
} as const;

export interface BedrockCompatibilityOptions {
  /**
   * AWS region the calls are made in, recorded as `cloud.region`. Defaults to
   * `AWS_REGION` from the environment (set on every Lambda); left off when
   * neither is known.
   */
  region?: string | undefined;
  /**
   * Rewrite `gen_ai.request.model` / `gen_ai.response.model` to the foundation
   * model id when the request used an inference profile or ARN. The original
   * spelling is always kept in `aws.bedrock.model.id_raw`. Default `true`.
   */
  normalizeModel?: boolean | undefined;
}

/**
 * A span processor that fills in the Bedrock-specific fields on the way out.
 *
 * It touches only spans whose `gen_ai.provider.name` is `aws.bedrock`, and on
 * those it adds `aws.bedrock.*` and `cloud.*` attributes and, unless disabled,
 * normalises the two model attributes. Every other span passes through
 * untouched.
 */
export function bedrockCompatibility(
  options: BedrockCompatibilityOptions = {},
): SpanProcessor {
  const region = options.region ?? process.env.AWS_REGION;
  const normalize = options.normalizeModel ?? true;

  return {
    onStart(_span: Span, _context: Context): void {},

    onEnd(span: ReadableSpan): void {
      // ReadableSpan exposes attributes as readonly; the langfuse enricher
      // mutates the same way, and the exporter reads the object afterwards.
      const attributes = span.attributes as Attributes;
      if (attributes[GEN_AI_PROVIDER_NAME] !== AWS_BEDROCK_PROVIDER) return;

      attributes[CLOUD_PROVIDER] ??= 'aws';
      if (region) attributes[CLOUD_REGION] ??= region;

      const raw = attributes[GEN_AI_REQUEST_MODEL];
      if (typeof raw !== 'string' || raw.length === 0) return;

      const parsed = parseBedrockModelId(raw);
      if (parsed.vendor) attributes[AWS_BEDROCK.MODEL_VENDOR] ??= parsed.vendor;
      if (parsed.inferenceProfileRegion) {
        attributes[AWS_BEDROCK.INFERENCE_PROFILE_REGION] ??=
          parsed.inferenceProfileRegion;
      }
      if (parsed.arn) attributes[AWS_BEDROCK.MODEL_ARN] ??= parsed.arn;

      if (normalize && parsed.modelId !== raw) {
        attributes[AWS_BEDROCK.MODEL_ID_RAW] ??= raw;
        attributes[GEN_AI_REQUEST_MODEL] = parsed.modelId;
        // The response model echoes the request spelling; keep the pair aligned.
        if (attributes[GEN_AI_RESPONSE_MODEL] === raw) {
          attributes[GEN_AI_RESPONSE_MODEL] = parsed.modelId;
        }
      }
    },

    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

/**
 * The part of Bedrock's `providerMetadata` read here. The trace is only
 * present when the request asked for it (`guardrailConfig.trace: 'enabled'`);
 * its assessment maps are keyed by guardrail id.
 */
type BedrockMetadataView = {
  trace?: {
    guardrail?: {
      inputAssessment?: { readonly [guardrailId: string]: JsonValue };
      outputAssessments?: { readonly [guardrailId: string]: JsonValue };
    };
  };
};

/**
 * Attributes for what Bedrock returned beside the standard response, for
 * `autotelTelemetry({ providerAttributes })`: the stop reason in Bedrock's own
 * words and, when the guardrail trace is on, which guardrail ran and whether
 * it intervened. An intervention leaves the span's status alone: the request
 * succeeded, the policy said no.
 *
 * @example
 * ```ts
 * registerTelemetry(
 *   autotelTelemetry({ pricing: BEDROCK_PRICING, providerAttributes: bedrockProviderAttributes }),
 * );
 * ```
 */
export function bedrockProviderAttributes(
  response: ProviderResponseView,
): Attributes | undefined {
  if (response.provider !== AWS_BEDROCK_PROVIDER) return undefined;
  const attributes: Attributes = {};
  if (response.rawFinishReason) {
    attributes[AWS_BEDROCK.STOP_REASON] = response.rawFinishReason;
    attributes[AWS_BEDROCK.GUARDRAIL_INTERVENED] =
      response.rawFinishReason === 'guardrail_intervened';
  }
  // SAFETY: the AI SDK forwards Bedrock's response metadata untyped; every
  // field read from it is optional, so an unexpected shape yields no attribute.
  const bedrock = response.providerMetadata?.bedrock as
    BedrockMetadataView | undefined;
  const guardrail = bedrock?.trace?.guardrail;
  const guardrailId = Object.keys({
    ...guardrail?.inputAssessment,
    ...guardrail?.outputAssessments,
  })[0];
  if (guardrailId) attributes[AWS_BEDROCK.GUARDRAIL_ID] = guardrailId;
  return attributes;
}

export { parseBedrockModelId, type ParsedBedrockModelId } from './model-id.js';
export { BEDROCK_PRICING, type BedrockModelPricing } from './pricing.js';

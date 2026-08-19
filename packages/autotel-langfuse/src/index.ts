/**
 * Langfuse compatibility.
 *
 * Langfuse ingests plain OTLP and reads the canonical `gen_ai.*` semantic
 * conventions, so an autotel span tree already arrives as generations,
 * embeddings, agents, and tools with model names, token usage, input/output,
 * and the right parent/child shape. Nothing here is required for that.
 *
 * What this module adds is the handful of facts Langfuse stores in dedicated
 * columns and reads from its own `langfuse.*` attributes, which no OpenTelemetry
 * convention covers:
 *
 *   - **Trace name.** Langfuse lists traces by name; a trace with none shows as
 *     an id. Derived from the root span's name.
 *   - **Prompt linking.** Moved from the canonical `gen_ai.prompt.name`, so a
 *     span that names its prompt links to the managed prompt in Langfuse. Moved,
 *     not copied: Langfuse reads the `gen_ai.prompt` prefix as the legacy
 *     prompt-content convention and drops `gen_ai.input.messages` /
 *     `gen_ai.output.messages` when it finds one.
 *   - **Time to first token.** autotel records it as a duration
 *     (`gen_ai.response.time_to_first_chunk`, seconds); Langfuse stores it as an
 *     absolute timestamp. Converted using the span's start time.
 *   - **Tags, release, version, public.** Application facts with no `gen_ai.*`
 *     equivalent, passed as options.
 *
 * Everything else Langfuse needs is already on the span, including `user.id` and
 * `session.id` from autotel's `setUser()` / `setSession()`, which Langfuse reads
 * under those standard names.
 *
 * @example
 * ```ts
 * import { init } from 'autotel';
 * import { langfuseCompatibility } from 'autotel-langfuse';
 *
 * init({
 *   service: 'support-agent',
 *   destinations: [{ endpoint: `${baseUrl}/api/public/otel`, headers }],
 *   spanEnrichers: [langfuseCompatibility({ tags: ['production'] })],
 * });
 * ```
 */

import type { AttributeValue, Attributes } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * Canonical attributes this processor reads. Spelled out rather than imported
 * from `autotel-genai` so the package has no dependency beyond the OTel API:
 * these are published convention names, and anything emitting them works here.
 */
const GEN_AI_TIME_TO_FIRST_CHUNK = 'gen_ai.response.time_to_first_chunk';
const GEN_AI_PROMPT_NAME = 'gen_ai.prompt.name';
const GEN_AI_PROMPT_VERSION = 'gen_ai.prompt.version';

/** Attributes Langfuse reads that have no OpenTelemetry equivalent. */
export const LANGFUSE = {
  TRACE_NAME: 'langfuse.trace.name',
  TRACE_TAGS: 'langfuse.trace.tags',
  TRACE_PUBLIC: 'langfuse.trace.public',
  RELEASE: 'langfuse.release',
  VERSION: 'langfuse.version',
  COMPLETION_START_TIME: 'langfuse.observation.completion_start_time',
  PROMPT_NAME: 'langfuse.observation.prompt.name',
  PROMPT_VERSION: 'langfuse.observation.prompt.version',
} as const;

export interface LangfuseCompatibilityOptions {
  /**
   * Name for the trace. A string, or a function of the root span. Defaults to
   * the root span's own name, which for an AI SDK call is `invoke_agent <fn>`
   * and for an application span is whatever you called it.
   *
   * Return `undefined` to leave the trace unnamed.
   */
  traceName?: string | ((span: ReadableSpan) => string | undefined);
  /** Tags applied to every trace. Langfuse filters and groups on these. */
  tags?: readonly string[];
  /** Deployment release, e.g. a git sha. Shown on the trace and filterable. */
  release?: string;
  /** Application version, distinct from the release that shipped it. */
  version?: string;
  /** Make traces publicly shareable. Off unless you mean it. */
  public?: boolean;
}

const isRoot = (span: ReadableSpan): boolean =>
  span.parentSpanContext === undefined;

/** Seconds since the span started, as an ISO timestamp. */
function offsetFromStart(span: ReadableSpan, seconds: number): string {
  const [startSeconds, startNanos] = span.startTime;
  const startMs = startSeconds * 1000 + startNanos / 1e6;
  return new Date(startMs + seconds * 1000).toISOString();
}

/**
 * A span processor that fills in the Langfuse-specific fields on the way out.
 *
 * It adds only attributes Langfuse reads, so the spans that reach every other
 * destination are unchanged apart from a few extra keys — with one exception:
 * `gen_ai.prompt.name` and `gen_ai.prompt.version` are *moved*, not copied. An
 * enricher runs once for the whole pipeline, so those two names are gone from
 * every destination. See `onEnd` for why leaving them is worse.
 */
export function langfuseCompatibility(
  options: LangfuseCompatibilityOptions = {},
): SpanProcessor {
  const resolveTraceName = (span: ReadableSpan): string | undefined => {
    if (typeof options.traceName === 'function') return options.traceName(span);
    return options.traceName ?? span.name;
  };

  return {
    onStart(_span: Span, _context: Context): void {
      // Everything this processor derives is only known once the span has run.
    },

    onEnd(span: ReadableSpan): void {
      // SAFETY: ReadableSpan types attributes as readonly; this processor's job
      // is to add the Langfuse-specific ones, which is what a span processor is
      // allowed to do before export.
      const attributes = span.attributes as Attributes;

      /**
       * Fill a field only when the span has not already answered it. These
       * options are process-wide defaults, and a span that set the attribute
       * itself knows something this configuration does not.
       */
      const fill = (key: string, value: AttributeValue | undefined): void => {
        if (value !== undefined && attributes[key] === undefined) {
          attributes[key] = value;
        }
      };

      if (isRoot(span)) {
        fill(LANGFUSE.TRACE_NAME, resolveTraceName(span));
        // Langfuse parses this one as a JSON array rather than an OTLP array.
        fill(
          LANGFUSE.TRACE_TAGS,
          options.tags?.length ? JSON.stringify([...options.tags]) : undefined,
        );
        fill(LANGFUSE.TRACE_PUBLIC, options.public);
      }

      fill(LANGFUSE.RELEASE, options.release);
      fill(LANGFUSE.VERSION, options.version);

      // Prompt linking. The canonical `gen_ai.prompt.name` is the same fact
      // Langfuse stores against a managed prompt, so a span that names its
      // prompt gets linked without the application knowing Langfuse exists.
      //
      // This *moves* the attributes rather than copying them, and it has to.
      // Langfuse's OTLP mapper treats anything under the `gen_ai.prompt`
      // prefix as the legacy prompt-content convention, and once it finds
      // one it reads input and output from that convention alone: the
      // observation's input becomes `{"name": ..., "version": ...}` and its
      // output becomes `{}`, discarding `gen_ai.input.messages` and
      // `gen_ai.output.messages` entirely. Leaving the canonical names on the
      // span destroys the very fields most people open Langfuse to read.
      const promptName = attributes[GEN_AI_PROMPT_NAME];
      if (typeof promptName === 'string') {
        attributes[LANGFUSE.PROMPT_NAME] ??= promptName;
        const promptVersion = attributes[GEN_AI_PROMPT_VERSION];
        if (typeof promptVersion === 'number') {
          attributes[LANGFUSE.PROMPT_VERSION] ??= promptVersion;
        }
        delete attributes[GEN_AI_PROMPT_NAME];
        delete attributes[GEN_AI_PROMPT_VERSION];
      }

      // Langfuse's "time to first token" is an absolute timestamp; autotel
      // records the same fact as a duration in seconds.
      const timeToFirstChunk = attributes[GEN_AI_TIME_TO_FIRST_CHUNK];
      if (
        typeof timeToFirstChunk === 'number' &&
        attributes[LANGFUSE.COMPLETION_START_TIME] === undefined
      ) {
        attributes[LANGFUSE.COMPLETION_START_TIME] = offsetFromStart(
          span,
          timeToFirstChunk,
        );
      }
    },

    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

export {
  GEN_AI_EVALUATION_RESULT,
  langfuseScores,
  toScorePayload,
  type LangfuseScoresOptions,
} from './scores.js';

export {
  langfuseMedia,
  mediaToken,
  type LangfuseMediaField,
  type LangfuseMediaOptions,
  type LangfuseMediaTarget,
  type UploadLangfuseMediaArgs,
} from './media.js';

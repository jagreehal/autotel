/**
 * Sampling Strategies
 *
 * Provides intelligent sampling beyond simple random rates.
 * Helps reduce telemetry costs while capturing critical data.
 *
 * Key strategies:
 * - Always trace errors and slow requests (critical for debugging)
 * - Sample by user ID for consistent request tracing
 * - Adaptive sampling based on load
 * - Sample by feature flags for A/B testing correlation
 *
 * @example
 * ```typescript
 * import { AlwaysOnErrorSampler, UserIdSampler } from './sampling'
 *
 * @Instrumented({
 *   serviceName: 'user',
 *   sampler: new AlwaysOnErrorSampler(0.1) // 10% baseline, 100% on errors
 * })
 * class UserService { }
 * ```
 */

import type { Link, Attributes } from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';
import { type Logger } from './logger';

/**
 * Sampler interface - return true to trace, false to skip
 */
export interface Sampler {
  /**
   * Decide whether to trace this operation
   *
   * @param context - Sampling context
   * @returns true to trace, false to skip
   */
  shouldSample(context: SamplingContext): boolean;

  /**
   * Whether this sampler needs tail sampling (post-execution decision)
   * If true, spans are always created and shouldKeepTrace() is called after execution
   *
   * @returns true if this sampler needs to evaluate after operation completes
   */
  needsTailSampling?(): boolean;

  /**
   * Re-evaluate sampling decision after operation completes (tail sampling)
   * Only called if needsTailSampling() returns true
   *
   * @param context - Sampling context
   * @param result - Operation result
   * @returns true if this trace should be kept, false to drop it
   */
  shouldKeepTrace?(context: SamplingContext, result: OperationResult): boolean;
}

/**
 * Context information for sampling decisions
 */
export interface SamplingContext {
  /** Operation name */
  operationName: string;
  /** Method arguments (for extracting user IDs, etc.) */
  args: unknown[];
  /** Optional metadata (e.g., feature flags, request headers) */
  metadata?: Record<string, unknown>;
  /** Optional span links for links-based sampling */
  links?: Link[];
}

/**
 * Result of a trace operation (for post-execution sampling)
 */
export interface OperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Error if operation failed */
  error?: Error;
}

/**
 * Simple random sampler
 *
 * @example
 * ```typescript
 * new RandomSampler(0.1) // Sample 10% of requests
 * ```
 */
export class RandomSampler implements Sampler {
  constructor(private readonly sampleRate: number) {
    if (sampleRate < 0 || sampleRate > 1) {
      throw new Error('Sample rate must be between 0 and 1');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldSample(_context: SamplingContext): boolean {
    return Math.random() < this.sampleRate;
  }
}

/**
 * Always sample (100% tracing)
 */
export class AlwaysSampler implements Sampler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldSample(_context: SamplingContext): boolean {
    return true;
  }
}

/**
 * Never sample (0% tracing)
 */
export class NeverSampler implements Sampler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldSample(_context: SamplingContext): boolean {
    return false;
  }
}

/**
 * Adaptive sampler that always traces errors and slow requests
 *
 * This is the recommended sampler for production use.
 * It ensures you never miss critical issues while keeping costs down.
 *
 * Strategy:
 * - Always trace errors (critical for debugging)
 * - Always trace slow requests (performance issues)
 * - Use baseline sample rate for successful fast requests
 *
 * **IMPORTANT - Tail Sampling Requirement:**
 * This sampler uses tail sampling (makes decisions AFTER execution).
 * You MUST use TailSamplingSpanProcessor for it to work correctly:
 *
 * - If using initInstrumentation(): TailSamplingSpanProcessor is auto-configured
 * - If using custom TracerProvider: You MUST manually register TailSamplingSpanProcessor
 *
 * Without TailSamplingSpanProcessor, ALL spans are exported (defeating the cost savings).
 *
 * @see TailSamplingSpanProcessor
 * @see README.md "Tail Sampling with Custom Providers" section
 *
 * @example
 * ```typescript
 * new AdaptiveSampler({
 *   baselineSampleRate: 0.1,    // 10% of normal requests
 *   slowThresholdMs: 1000,       // Requests > 1s are "slow"
 *   alwaysSampleErrors: true,    // Always trace errors
 *   alwaysSampleSlow: true       // Always trace slow requests
 * })
 * ```
 */
export class AdaptiveSampler implements Sampler {
  private baselineSampleRate: number;
  private slowThresholdMs: number;
  private alwaysSampleErrors: boolean;
  private alwaysSampleSlow: boolean;
  private linksBased: boolean;
  private linksRate: number;
  private logger?: Logger;

  // Track whether we should sample this request
  private readonly samplingDecisions = new WeakMap<unknown[], boolean>();
  // Track operation results to enable post-execution decision
  private readonly operationResults = new WeakMap<unknown[], OperationResult>();

  constructor(
    options: {
      baselineSampleRate?: number;
      slowThresholdMs?: number;
      alwaysSampleErrors?: boolean;
      alwaysSampleSlow?: boolean;
      /** Enable links-based sampling for event-driven architectures */
      linksBased?: boolean;
      /** Sampling rate for spans linked to sampled spans (0.0-1.0) */
      linksRate?: number;
      logger?: Logger;
    } = {},
  ) {
    this.baselineSampleRate = options.baselineSampleRate ?? 0.1;
    this.slowThresholdMs = options.slowThresholdMs ?? 1000;
    this.alwaysSampleErrors = options.alwaysSampleErrors ?? true;
    this.alwaysSampleSlow = options.alwaysSampleSlow ?? true;
    this.linksBased = options.linksBased ?? false;
    this.linksRate = options.linksRate ?? 1;
    this.logger = options.logger;

    if (this.baselineSampleRate < 0 || this.baselineSampleRate > 1) {
      throw new Error('Baseline sample rate must be between 0 and 1');
    }
    if (this.linksRate < 0 || this.linksRate > 1) {
      throw new Error('Links rate must be between 0 and 1');
    }
  }

  needsTailSampling(): boolean {
    // AdaptiveSampler ALWAYS needs tail sampling to implement error/slow capture
    return true;
  }

  shouldSample(context: SamplingContext): boolean {
    // For tail sampling, we optimistically create spans for all requests
    // The real decision happens in shouldKeepTrace() after execution
    // We still store the baseline decision for shouldKeepTrace() to use
    const baselineDecision = Math.random() < this.baselineSampleRate;
    this.samplingDecisions.set(context.args, baselineDecision);

    // Always return true to create the span (tail sampling will decide if we keep it)
    return true;
  }

  /**
   * Check if any links point to sampled spans.
   *
   * A span is considered linked to a sampled span if any of its links
   * have trace_flags with the sampled bit set (0x01).
   *
   * @param links - Array of span links to check
   * @returns true if any linked span is sampled, false otherwise
   */
  hasSampledLink(links: Link[]): boolean {
    if (!links || links.length === 0) {
      return false;
    }
    return links.some(
      (link) =>
        link.context && (link.context.traceFlags & TraceFlags.SAMPLED) !== 0,
    );
  }

  /**
   * Re-evaluate sampling decision after operation completes
   *
   * This allows us to always capture errors and slow requests,
   * even if they weren't initially sampled.
   *
   * @param context - Sampling context
   * @param result - Operation result
   * @returns true if this operation should be kept (not discarded)
   */
  shouldKeepTrace(context: SamplingContext, result: OperationResult): boolean {
    const baselineDecision = this.samplingDecisions.get(context.args) ?? false;

    // Always keep errors
    if (this.alwaysSampleErrors && !result.success) {
      if (!baselineDecision) {
        this.logger?.debug('Adaptive sampling: Keeping error trace', {
          operation: context.operationName,
          error: result.error?.message,
        });
      }
      return true;
    }

    // Always keep slow requests
    if (this.alwaysSampleSlow && result.duration >= this.slowThresholdMs) {
      if (!baselineDecision) {
        this.logger?.debug('Adaptive sampling: Keeping slow trace', {
          operation: context.operationName,
          duration: result.duration,
        });
      }
      return true;
    }

    // Check for sampled links (links-based sampling for event-driven systems)
    if (
      this.linksBased &&
      context.links &&
      this.hasSampledLink(context.links)
    ) {
      // Use linksRate to decide whether to keep the linked span
      const keepLinked = Math.random() < this.linksRate;
      if (keepLinked && !baselineDecision) {
        this.logger?.debug(
          'Adaptive sampling: Keeping trace due to sampled link',
          {
            operation: context.operationName,
            linkCount: context.links.length,
          },
        );
      }
      return keepLinked;
    }

    // Otherwise, use baseline decision
    return baselineDecision;
  }
}

/**
 * User-based sampler for consistent tracing
 *
 * Always samples requests from specific user IDs.
 * Useful for debugging specific user issues or monitoring VIP users.
 *
 * @example
 * ```typescript
 * new UserIdSampler({
 *   baselineSampleRate: 0.01,      // 1% of normal users
 *   alwaysSampleUsers: ['vip_123'], // Always trace VIP users
 *   extractUserId: (args) => args[0]?.userId // Extract user ID from first arg
 * })
 * ```
 */
export class UserIdSampler implements Sampler {
  private baselineSampleRate: number;
  private alwaysSampleUsers: Set<string>;
  private extractUserId: (args: unknown[]) => string | undefined;
  private logger?: Logger;

  constructor(options: {
    baselineSampleRate?: number;
    alwaysSampleUsers?: string[];
    extractUserId: (args: unknown[]) => string | undefined;
    logger?: Logger;
  }) {
    this.baselineSampleRate = options.baselineSampleRate ?? 0.1;
    this.alwaysSampleUsers = new Set(options.alwaysSampleUsers || []);
    this.extractUserId = options.extractUserId;
    this.logger = options.logger;
  }

  shouldSample(context: SamplingContext): boolean {
    const userId = this.extractUserId(context.args);

    // Always sample specific users
    if (userId && this.alwaysSampleUsers.has(userId)) {
      this.logger?.debug('Sampling user request', {
        operation: context.operationName,
        userId,
      });
      return true;
    }

    // For consistent per-user sampling, hash the user ID
    if (userId) {
      const hash = this.hashString(userId);
      return hash < this.baselineSampleRate;
    }

    // Fallback to random sampling if no user ID
    return Math.random() < this.baselineSampleRate;
  }

  /**
   * Add user IDs to always-sample list
   */
  addAlwaysSampleUsers(...userIds: string[]): void {
    for (const userId of userIds) {
      this.alwaysSampleUsers.add(userId);
    }
  }

  /**
   * Remove user IDs from always-sample list
   */
  removeAlwaysSampleUsers(...userIds: string[]): void {
    for (const userId of userIds) {
      this.alwaysSampleUsers.delete(userId);
    }
  }

  /**
   * Simple hash function for consistent user sampling
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.codePointAt(i) ?? 0;
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) / 2_147_483_647; // Normalize to 0-1
  }
}

/**
 * Composite sampler that combines multiple samplers
 *
 * Samples if ANY of the child samplers returns true.
 *
 * @example
 * ```typescript
 * new CompositeSampler([
 *   new UserIdSampler({ extractUserId: (args) => args[0]?.userId }),
 *   new AdaptiveSampler({ baselineSampleRate: 0.1 })
 * ])
 * ```
 */
export class CompositeSampler implements Sampler {
  constructor(private readonly samplers: Sampler[]) {
    if (samplers.length === 0) {
      throw new Error('CompositeSampler requires at least one child sampler');
    }
  }

  shouldSample(context: SamplingContext): boolean {
    return this.samplers.some((sampler) => sampler.shouldSample(context));
  }
}

/**
 * Feature flag sampler
 *
 * Always samples requests with specific feature flags enabled.
 * Perfect for correlating A/B test experiments with metrics.
 *
 * @example
 * ```typescript
 * new FeatureFlagSampler({
 *   baselineSampleRate: 0.01,
 *   alwaysSampleFlags: ['new_checkout', 'experimental_ui'],
 *   extractFlags: (args, metadata) => metadata?.featureFlags
 * })
 * ```
 */
export class FeatureFlagSampler implements Sampler {
  private baselineSampleRate: number;
  private alwaysSampleFlags: Set<string>;
  private extractFlags: (
    args: unknown[],
    metadata?: Record<string, unknown>,
  ) => string[] | undefined;
  private logger?: Logger;

  constructor(options: {
    baselineSampleRate?: number;
    alwaysSampleFlags?: string[];
    extractFlags: (
      args: unknown[],
      metadata?: Record<string, unknown>,
    ) => string[] | undefined;
    logger?: Logger;
  }) {
    this.baselineSampleRate = options.baselineSampleRate ?? 0.1;
    this.alwaysSampleFlags = new Set(options.alwaysSampleFlags || []);
    this.extractFlags = options.extractFlags;
    this.logger = options.logger;
  }

  shouldSample(context: SamplingContext): boolean {
    const flags = this.extractFlags(context.args, context.metadata);

    // Always sample if any monitored flag is enabled
    if (flags && flags.some((flag) => this.alwaysSampleFlags.has(flag))) {
      this.logger?.debug('Sampling feature flag request', {
        operation: context.operationName,
        flags,
      });
      return true;
    }

    // Fallback to random sampling
    return Math.random() < this.baselineSampleRate;
  }

  /**
   * Add feature flags to always-sample list
   */
  addAlwaysSampleFlags(...flags: string[]): void {
    for (const flag of flags) {
      this.alwaysSampleFlags.add(flag);
    }
  }

  /**
   * Remove feature flags from always-sample list
   */
  removeAlwaysSampleFlags(...flags: string[]): void {
    for (const flag of flags) {
      this.alwaysSampleFlags.delete(flag);
    }
  }
}

// ============================================================================
// Link Helper Functions
// ============================================================================

/**
 * Create a Link from W3C trace context headers (e.g., from a message queue).
 *
 * This is useful for message consumers that need to link to the producer span.
 * The headers should contain at least a `traceparent` header in W3C format.
 *
 * @param headers - Dictionary containing traceparent/tracestate headers
 * @param attributes - Optional attributes for the link
 * @returns Link object if context could be extracted, null otherwise
 *
 * @example
 * ```typescript
 * // In a Kafka consumer
 * const headers = { traceparent: '00-abc123...-def456...-01' };
 * const link = createLinkFromHeaders(headers);
 * if (link) {
 *   // Use with tracer.startActiveSpan options or ctx.addLink()
 *   tracer.startActiveSpan('process.message', { links: [link] }, span => { ... });
 * }
 * ```
 */
export function createLinkFromHeaders(
  headers: Record<string, string>,
  attributes?: Attributes,
): Link | null {
  // Parse W3C traceparent header directly for reliability
  // Format: version-traceId-spanId-traceFlags (e.g., 00-abc123...-def456...-01)
  const traceparent = headers.traceparent || headers['traceparent'];
  if (!traceparent) {
    return null;
  }

  const spanContext = parseTraceparent(traceparent);
  if (!spanContext || !isValidSpanContext(spanContext)) {
    return null;
  }

  return {
    context: spanContext,
    attributes: attributes ?? {},
  };
}

/**
 * Extract Links from a batch of messages for fan-in scenarios.
 *
 * Useful for batch processing where multiple producer spans should be linked.
 * This enables tracing causality in event-driven architectures where a single
 * consumer processes messages from multiple producers.
 *
 * @param messages - List of message objects
 * @param headersKey - Key in each message containing trace headers (default: 'headers')
 * @returns List of Link objects for all valid trace contexts
 *
 * @example
 * ```typescript
 * // Processing a batch of SQS/Kafka messages
 * const messages = [
 *   { body: '...', headers: { traceparent: '...' } },
 *   { body: '...', headers: { traceparent: '...' } },
 * ];
 * const links = extractLinksFromBatch(messages);
 *
 * tracer.startActiveSpan('process.batch', { links }, span => {
 *   for (const msg of messages) {
 *     processMessage(msg);
 *   }
 * });
 * ```
 */
export function extractLinksFromBatch(
  messages: Array<{ [key: string]: unknown }>,
  headersKey: string = 'headers',
): Link[] {
  const links: Link[] = [];

  for (const msg of messages) {
    const msgHeaders = msg[headersKey];
    if (msgHeaders && typeof msgHeaders === 'object' && msgHeaders !== null) {
      const link = createLinkFromHeaders(msgHeaders as Record<string, string>, {
        'messaging.batch.message_index': links.length,
      });
      if (link) {
        links.push(link);
      }
    }
  }

  return links;
}

/**
 * Parse W3C traceparent header into SpanContext
 * Format: version-traceId-spanId-traceFlags (e.g., 00-abc123...-def456...-01)
 *
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
function parseTraceparent(
  traceparent: string,
): import('@opentelemetry/api').SpanContext | null {
  // W3C traceparent format: version-traceId-parentId-traceFlags
  // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
  const TRACEPARENT_REGEX =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

  const match = traceparent.match(TRACEPARENT_REGEX);
  if (!match || match.length < 5) {
    return null;
  }

  const version = match[1];
  const traceId = match[2];
  const spanId = match[3];
  const flags = match[4];

  // Validate all parts are present (TypeScript narrowing)
  if (!version || !traceId || !spanId || !flags) {
    return null;
  }

  // Version 00 is currently the only version, but we should be forward compatible
  if (version === 'ff') {
    // Version ff is invalid according to spec
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    isRemote: true,
  };
}

/**
 * Check if a SpanContext is valid (has non-zero trace and span IDs)
 */
function isValidSpanContext(
  spanContext: import('@opentelemetry/api').SpanContext | null,
): spanContext is import('@opentelemetry/api').SpanContext {
  if (!spanContext) return false;
  // TraceId should not be all zeros (00000000000000000000000000000000)
  // SpanId should not be all zeros (0000000000000000)
  return (
    spanContext.traceId !== '00000000000000000000000000000000' &&
    spanContext.spanId !== '0000000000000000'
  );
}

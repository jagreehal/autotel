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
      logger?: Logger;
    } = {},
  ) {
    this.baselineSampleRate = options.baselineSampleRate ?? 0.1;
    this.slowThresholdMs = options.slowThresholdMs ?? 1000;
    this.alwaysSampleErrors = options.alwaysSampleErrors ?? true;
    this.alwaysSampleSlow = options.alwaysSampleSlow ?? true;
    this.logger = options.logger;

    if (this.baselineSampleRate < 0 || this.baselineSampleRate > 1) {
      throw new Error('Baseline sample rate must be between 0 and 1');
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

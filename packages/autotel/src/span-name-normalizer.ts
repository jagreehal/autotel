/**
 * Span Name Normalizer
 *
 * Normalizes span names to reduce cardinality from dynamic path segments.
 * This is critical for observability backends that charge by unique span names
 * or have cardinality limits.
 *
 * @example Basic usage with custom function
 * ```typescript
 * init({
 *   service: 'my-app',
 *   spanNameNormalizer: (name) => {
 *     return name.replace(/\/[0-9]+/g, '/:id');
 *   }
 * })
 * ```
 *
 * @example Using built-in preset
 * ```typescript
 * init({
 *   service: 'my-app',
 *   spanNameNormalizer: 'rest-api'
 * })
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Function to normalize a span name
 * @param name - The original span name
 * @returns The normalized span name
 */
export type SpanNameNormalizerFn = (name: string) => string;

/**
 * Built-in normalizer preset names
 */
export type SpanNameNormalizerPreset = 'rest-api' | 'graphql' | 'minimal';

/**
 * Normalizer config - either a function or a preset name
 */
export type SpanNameNormalizerConfig =
  | SpanNameNormalizerFn
  | SpanNameNormalizerPreset;

export interface SpanNameNormalizingProcessorOptions {
  /**
   * Normalizer function or preset name
   */
  normalizer: SpanNameNormalizerConfig;
}

/**
 * Built-in normalizer patterns
 */
const NORMALIZER_PATTERNS = {
  // Numeric IDs: /users/123 → /users/:id
  numericId: /\/\d+(?=\/|$)/g,

  // UUIDs: /users/550e8400-e29b-41d4-a716-446655440000 → /users/:uuid
  uuid: /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,

  // Short UUIDs (without dashes): /users/550e8400e29b41d4a716446655440000 → /users/:uuid
  shortUuid: /\/[0-9a-f]{32}(?=\/|$)/gi,

  // MongoDB ObjectIds: /docs/507f1f77bcf86cd799439011 → /docs/:objectId
  objectId: /\/[0-9a-f]{24}(?=\/|$)/gi,

  // Hashes (6+ hex chars): /assets/abc123def.js → /assets/:hash.js
  hash: /\/[0-9a-f]{6,}(?=\.[a-z]+$)/gi,

  // ISO dates: /logs/2024-01-15 → /logs/:date
  isoDate: /\/\d{4}-\d{2}-\d{2}(?=\/|$)/g,

  // Timestamps: /events/1705334400 → /events/:timestamp
  timestamp: /\/1[0-9]{9}(?=\/|$)/g,

  // Email-like segments: /users/john@example.com → /users/:email
  email: /\/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?=\/|$)/g,
} as const;

/**
 * Built-in normalizer presets
 */
const NORMALIZER_PRESETS: Record<
  SpanNameNormalizerPreset,
  SpanNameNormalizerFn
> = {
  /**
   * REST API preset - normalizes common REST path patterns
   * Handles: numeric IDs, UUIDs, ObjectIds, dates, timestamps, emails
   */
  'rest-api': (name: string): string => {
    return name
      .replaceAll(NORMALIZER_PATTERNS.uuid, '/:uuid')
      .replaceAll(NORMALIZER_PATTERNS.shortUuid, '/:uuid')
      .replaceAll(NORMALIZER_PATTERNS.objectId, '/:objectId')
      .replaceAll(NORMALIZER_PATTERNS.isoDate, '/:date')
      .replaceAll(NORMALIZER_PATTERNS.timestamp, '/:timestamp')
      .replaceAll(NORMALIZER_PATTERNS.email, '/:email')
      .replaceAll(NORMALIZER_PATTERNS.numericId, '/:id');
  },

  /**
   * GraphQL preset - normalizes GraphQL operation names and paths
   * Keeps query/mutation names but normalizes embedded IDs
   */
  graphql: (name: string): string => {
    // For GraphQL, normalize both path-style and embedded IDs
    return name
      .replaceAll(NORMALIZER_PATTERNS.uuid, '/:uuid')
      .replaceAll(NORMALIZER_PATTERNS.numericId, '/:id');
  },

  /**
   * Minimal preset - only normalizes numeric IDs and UUIDs
   */
  minimal: (name: string): string => {
    return name
      .replaceAll(NORMALIZER_PATTERNS.uuid, '/:uuid')
      .replaceAll(NORMALIZER_PATTERNS.numericId, '/:id');
  },
};

/**
 * Resolve normalizer config to a function
 */
function resolveNormalizer(
  config: SpanNameNormalizerConfig,
): SpanNameNormalizerFn {
  if (typeof config === 'function') {
    return config;
  }

  const preset = NORMALIZER_PRESETS[config];
  if (!preset) {
    throw new Error(
      `Unknown span name normalizer preset: "${config}". ` +
        `Available presets: ${Object.keys(NORMALIZER_PRESETS).join(', ')}`,
    );
  }

  return preset;
}

/**
 * Span processor that normalizes span names to reduce cardinality.
 *
 * Normalization happens in onStart() when we have access to the mutable Span.
 * This allows us to call span.updateName() before the span is finalized.
 *
 * Common use cases:
 * - REST APIs: /users/123/posts/456 → /users/:id/posts/:id
 * - UUIDs: /items/550e8400-e29b-41d4-a716-446655440000 → /items/:uuid
 * - Dates: /logs/2024-01-15 → /logs/:date
 */
export class SpanNameNormalizingProcessor implements SpanProcessor {
  private readonly wrappedProcessor: SpanProcessor;
  private readonly normalizer: SpanNameNormalizerFn;

  constructor(
    wrappedProcessor: SpanProcessor,
    options: SpanNameNormalizingProcessorOptions,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    this.normalizer = resolveNormalizer(options.normalizer);
  }

  /**
   * Normalize span name on start (when Span is mutable)
   */
  onStart(span: Span, parentContext: Context): void {
    try {
      const originalName = span.name;
      const normalizedName = this.normalizer(originalName);

      if (normalizedName !== originalName) {
        span.updateName(normalizedName);
      }
    } catch {
      // If normalizer throws, keep original name (fail-open)
    }

    this.wrappedProcessor.onStart(span, parentContext);
  }

  /**
   * Pass through onEnd unchanged
   */
  onEnd(span: ReadableSpan): void {
    this.wrappedProcessor.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}

/**
 * Export built-in patterns for advanced users who want to compose their own normalizers
 */
export { NORMALIZER_PATTERNS, NORMALIZER_PRESETS };

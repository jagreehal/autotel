/**
 * Batch lineage utilities for fan-in trace correlation.
 *
 * When processing batches of messages (e.g., aggregating multiple orders),
 * this utility extracts and correlates trace IDs from all messages
 * to create meaningful span links.
 *
 * This is a minimal implementation focused on SpanLinks only.
 * No body inspection, no complex inference.
 */

import { otelTrace as trace, type SpanContext, type SpanLink } from 'autotel';
import type {
  BatchItem,
  BatchLineageOptions,
  BatchLineageResult,
  ExtractedContext,
} from './types';
import { normalizeHeaders, extractTraceContext } from './headers';

const DEFAULT_MAX_LINKS = 128;

/**
 * Check if a span context is valid for creating links.
 * Must have both traceId and spanId.
 */
function isValidSpanContext(
  spanContext: SpanContext | undefined,
): spanContext is SpanContext {
  return !!(
    spanContext &&
    spanContext.traceId &&
    spanContext.spanId &&
    trace.isSpanContextValid(spanContext)
  );
}

/**
 * Synchronous hash using djb2 algorithm.
 */
function hashTraceIdsSync(traceIds: string[]): string {
  const input = traceIds.join('|');

  // Simple djb2-style hash
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // eslint-disable-next-line unicorn/prefer-code-point
    hash = (hash * 33) ^ input.charCodeAt(i);
  }

  // Convert to unsigned 32-bit, then hex, pad to 16 chars
  return (hash >>> 0).toString(16).padStart(16, '0');
}

/**
 * Extract batch lineage from a collection of RabbitMQ messages.
 *
 * For each message with headers:
 * 1. Extract SpanContext using OTel propagators
 * 2. Filter to valid SpanContexts (must have traceId + spanId)
 * 3. Deduplicate by traceId
 * 4. Sort trace IDs alphabetically for deterministic hash
 * 5. Create hash of sorted trace IDs
 * 6. Create SpanLinks from valid contexts (capped at maxLinks)
 *
 * @param items - Array of items with optional headers
 * @param options - Extraction options
 * @returns Batch lineage result with links and metadata
 *
 * @example Basic batch lineage
 * ```typescript
 * import { extractBatchLineage, withConsumeSpan } from 'autotel-plugins/rabbitmq';
 *
 * // Aggregate multiple messages
 * const lineage = extractBatchLineage(
 *   messages.map(m => ({ headers: m.properties.headers }))
 * );
 *
 * await withConsumeSpan({
 *   name: 'batch.aggregate',
 *   headers: {},
 *   contextMode: 'none',
 *   links: lineage.links,
 *   queue: 'aggregator',
 * }, async (span) => {
 *   span.setAttribute('linked_trace_id_count', lineage.linked_trace_id_count);
 *   span.setAttribute('linked_trace_id_hash', lineage.linked_trace_id_hash);
 *   await processBatch(messages);
 * });
 * ```
 */
export function extractBatchLineage(
  items: BatchItem[],
  options: BatchLineageOptions = {},
): BatchLineageResult {
  const { includeTraceIds = false, maxLinks = DEFAULT_MAX_LINKS } = options;

  // Extract valid span contexts from items
  const extractedContexts: ExtractedContext[] = [];
  const seenTraceIds = new Set<string>();

  for (const item of items) {
    const normalizedHeaders = normalizeHeaders(item.headers);
    const extractedCtx = extractTraceContext(normalizedHeaders);
    const spanContext = trace.getSpanContext(extractedCtx);

    // Check valid span context and deduplicate by traceId
    if (
      isValidSpanContext(spanContext) &&
      !seenTraceIds.has(spanContext.traceId)
    ) {
      seenTraceIds.add(spanContext.traceId);
      extractedContexts.push({
        traceId: spanContext.traceId,
        spanContext,
      });
    }
  }

  // Sort by traceId for deterministic hash
  extractedContexts.sort((a, b) => a.traceId.localeCompare(b.traceId));

  const traceIds = extractedContexts.map((ec) => ec.traceId);

  // Create links (capped at maxLinks)
  const links: SpanLink[] = extractedContexts
    .slice(0, maxLinks)
    .map((ec) => ({ context: ec.spanContext }));

  // Compute hash
  const hash =
    traceIds.length > 0 ? hashTraceIdsSync(traceIds) : '0000000000000000';

  return {
    linked_trace_id_count: traceIds.length,
    linked_trace_id_hash: hash,
    links,
    ...(includeTraceIds && { trace_ids: traceIds }),
  };
}

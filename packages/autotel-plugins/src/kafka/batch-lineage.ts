/**
 * Batch lineage utilities for fan-in trace correlation.
 *
 * When processing batches of messages (e.g., settlement batches),
 * this utility extracts and correlates trace IDs from all messages
 * to create meaningful span links and aggregation metadata.
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
 * Simple SHA-256 hash for batch lineage.
 *
 * Uses Web Crypto API (available in Node.js 15+ and all modern browsers).
 * Falls back to a simple hash if crypto is unavailable.
 */
async function hashTraceIds(traceIds: string[]): Promise<string> {
  const input = traceIds.join('|');

  try {
    // Use Web Crypto API (available in Node.js 15+)
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    // Convert to hex and take first 16 chars (64 bits)
    return [...hashArray]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    // Fallback: simple djb2-style hash
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      // eslint-disable-next-line unicorn/prefer-code-point
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    // Convert to unsigned 32-bit, then hex, pad to 16 chars
    return (hash >>> 0).toString(16).padStart(16, '0');
  }
}

/**
 * Synchronous hash fallback for when async is not suitable.
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
 * Extract batch lineage from a collection of messages.
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
 * import { extractBatchLineage, withProcessingSpan } from 'autotel-plugins/kafka';
 *
 * // In batch consumer
 * const lineage = extractBatchLineage(batch, { maxLinks: 50 });
 *
 * await withProcessingSpan({
 *   name: 'settlement.batch',
 *   headers: {},
 *   contextMode: 'none',
 *   links: lineage.links,
 *   topic: 'settlements',
 *   consumerGroup: 'batcher',
 * }, async (span) => {
 *   span.setAttribute('linked_trace_id_count', lineage.linked_trace_id_count);
 *   span.setAttribute('linked_trace_id_hash', lineage.linked_trace_id_hash);
 *   await processSettlement(batch);
 * });
 * ```
 *
 * @example With trace IDs for debugging
 * ```typescript
 * const lineage = extractBatchLineage(batch, {
 *   includeTraceIds: true,  // Warning: may contain sensitive data
 *   maxLinks: 100,
 * });
 *
 * console.log('Processing batch from traces:', lineage.trace_ids);
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

/**
 * Async version of extractBatchLineage that uses crypto.subtle for hashing.
 *
 * Use this when you need cryptographically secure hashing and can await.
 *
 * @param items - Array of items with optional headers
 * @param options - Extraction options
 * @returns Promise resolving to batch lineage result
 *
 * @example
 * ```typescript
 * const lineage = await extractBatchLineageAsync(batch, { maxLinks: 50 });
 * ```
 */
export async function extractBatchLineageAsync(
  items: BatchItem[],
  options: BatchLineageOptions = {},
): Promise<BatchLineageResult> {
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

  // Compute hash using crypto.subtle
  const hash =
    traceIds.length > 0 ? await hashTraceIds(traceIds) : '0000000000000000';

  return {
    linked_trace_id_count: traceIds.length,
    linked_trace_id_hash: hash,
    links,
    ...(includeTraceIds && { trace_ids: traceIds }),
  };
}

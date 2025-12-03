/**
 * Response metadata extraction utilities
 */

import type { AWSCommandMetadata } from '../types';

/**
 * Extract response metadata from AWS SDK v3 response
 */
export function extractResponseMetadata(
  response: { $metadata?: Record<string, unknown> }
): Partial<AWSCommandMetadata> {
  const metadata = response.$metadata || {};
  return {
    requestId: metadata.requestId as string | undefined,
    httpStatusCode: metadata.httpStatusCode as number | undefined,
    extendedRequestId: metadata.extendedRequestId as string | undefined,
    cfId: metadata.cfId as string | undefined,
  };
}

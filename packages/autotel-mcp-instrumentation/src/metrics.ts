/**
 * MCP operation duration metrics per OTel MCP semantic conventions.
 *
 * Provides lazy-initialized histograms for client and server operation durations.
 */

import { metrics, type Histogram, type Attributes } from '@opentelemetry/api';
import { MCP_METRICS, MCP_DURATION_BUCKETS } from './semantic-conventions';

let clientDuration: Histogram | undefined;
let serverDuration: Histogram | undefined;

function getClientDuration(): Histogram {
  if (!clientDuration) {
    const meter = metrics.getMeter('autotel-mcp');
    clientDuration = meter.createHistogram(
      MCP_METRICS.CLIENT_OPERATION_DURATION,
      {
        description: 'Duration of MCP client operations',
        unit: 's',
        advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS },
      },
    );
  }
  return clientDuration;
}

function getServerDuration(): Histogram {
  if (!serverDuration) {
    const meter = metrics.getMeter('autotel-mcp');
    serverDuration = meter.createHistogram(
      MCP_METRICS.SERVER_OPERATION_DURATION,
      {
        description: 'Duration of MCP server operations',
        unit: 's',
        advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS },
      },
    );
  }
  return serverDuration;
}

/** Record a client operation duration in seconds */
export function recordClientOperationDuration(
  durationS: number,
  attrs: Attributes,
): void {
  getClientDuration().record(durationS, attrs);
}

/** Record a server operation duration in seconds */
export function recordServerOperationDuration(
  durationS: number,
  attrs: Attributes,
): void {
  getServerDuration().record(durationS, attrs);
}

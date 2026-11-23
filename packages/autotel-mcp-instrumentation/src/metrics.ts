/**
 * MCP operation duration metrics per OTel MCP semantic conventions.
 *
 * Provides lazy-initialized histograms for client and server operation durations.
 */

import {
  metrics,
  type Counter,
  type Histogram,
  type Attributes,
} from '@opentelemetry/api';
import { MCP_METRICS, MCP_DURATION_BUCKETS } from './semantic-conventions';

let clientDuration: Histogram | undefined;
let serverDuration: Histogram | undefined;
let securityEvents: Counter | undefined;

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

function getSecurityEvents(): Counter {
  if (!securityEvents) {
    const meter = metrics.getMeter('autotel-mcp');
    securityEvents = meter.createCounter(MCP_METRICS.SECURITY_EVENTS, {
      description:
        'Count of MCP security signals (injection suspicions, budget breaches)',
      unit: '{event}',
    });
  }
  return securityEvents;
}

/** Increment the security-events counter (injection / budget signals). */
export function recordSecurityEvent(attrs: Attributes): void {
  getSecurityEvents().add(1, attrs);
}

/** Create an instrument on first use, so a process without a meter pays nothing. */
function lazily<T>(create: () => T): () => T {
  let instrument: T | undefined;
  return () => (instrument ??= create());
}

const eventCounter = (name: string, description: string) =>
  lazily(() =>
    metrics
      .getMeter('autotel-mcp')
      .createCounter(name, { description, unit: '{event}' }),
  );

const eventsDelivered = eventCounter(
  MCP_METRICS.SERVER_EVENT_DELIVERED,
  'MCP event occurrences delivered by a server',
);
const eventsReceived = eventCounter(
  MCP_METRICS.CLIENT_EVENT_RECEIVED,
  'MCP event occurrences received by a client',
);
const eventGaps = eventCounter(
  MCP_METRICS.CLIENT_EVENT_GAPS,
  'MCP event receipts that reported skipped events',
);
const subscriptionsTerminated = eventCounter(
  MCP_METRICS.CLIENT_EVENT_TERMINATED,
  'MCP event subscriptions terminated by the server',
);
const eventLag = lazily(() =>
  metrics
    .getMeter('autotel-mcp')
    .createHistogram(MCP_METRICS.CLIENT_EVENT_LAG, {
      description:
        'Seconds from when an MCP event occurred to when the client received it',
      unit: 's',
      advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS },
    }),
);

/** Occurrences a server delivered (poll results and pushed notifications). */
export function recordEventsDelivered(count: number, attrs: Attributes): void {
  if (count > 0) eventsDelivered().add(count, attrs);
}

/** One occurrence received, and how late it arrived. */
export function recordEventReceived(
  lagS: number | undefined,
  attrs: Attributes,
): void {
  eventsReceived().add(1, attrs);
  if (lagS !== undefined) eventLag().record(lagS, attrs);
}

/** A receipt reported `truncated: true`. */
export function recordEventGap(attrs: Attributes): void {
  eventGaps().add(1, attrs);
}

/** The server ended a subscription. */
export function recordSubscriptionTerminated(attrs: Attributes): void {
  subscriptionsTerminated().add(1, attrs);
}

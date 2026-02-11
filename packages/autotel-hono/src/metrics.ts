/**
 * HTTP server metrics per OTel semantic conventions.
 *
 * Lazy-initialized request duration histogram and active-requests up/down counter.
 */

type AttributeValue = string | number | boolean | undefined;
export type Attributes = Record<string, AttributeValue>;

type Histogram = {
  record: (value: number, attrs?: Attributes) => void;
};

type UpDownCounter = {
  add: (value: number, attrs?: Attributes) => void;
};

export type Meter = {
  createHistogram: (
    name: string,
    options?: {
      description?: string;
      unit?: string;
      advice?: { explicitBucketBoundaries?: number[] };
    },
  ) => Histogram;
  createUpDownCounter: (
    name: string,
    options?: {
      description?: string;
    },
  ) => UpDownCounter;
};

/** OTel HTTP server metric names (stable convention names) */
const METRIC_HTTP_SERVER_REQUEST_DURATION = 'http.server.request.duration';
const METRIC_HTTP_SERVER_ACTIVE_REQUESTS = 'http.server.active_requests';

/** Recommended bucket boundaries for request duration (seconds) */
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

export type HttpMetricsConfig = {
  meter: Meter;
  captureRequestDuration?: boolean;
  captureActiveRequests?: boolean;
};

export function createRequestDurationTracker(config: HttpMetricsConfig): {
  record: (durationSeconds: number, attrs: Attributes) => void;
} {
  if (config.captureRequestDuration === false) {
    return { record: () => {} };
  }
  const histogram = config.meter.createHistogram(
    METRIC_HTTP_SERVER_REQUEST_DURATION,
    {
      description: 'Duration of HTTP server requests in seconds',
      unit: 's',
      advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
    },
  );
  return {
    record(durationSeconds: number, attrs: Attributes) {
      histogram.record(durationSeconds, attrs);
    },
  };
}

export function createActiveRequestsTracker(config: HttpMetricsConfig): {
  increment: (attrs: Attributes) => void;
  decrement: (attrs: Attributes) => void;
} | undefined {
  if (config.captureActiveRequests === false) {
    return undefined;
  }
  const counter = config.meter.createUpDownCounter(
    METRIC_HTTP_SERVER_ACTIVE_REQUESTS,
    {
      description: 'Number of active (in-flight) HTTP server requests',
    },
  );
  return {
    increment(attrs: Attributes) {
      counter.add(1, attrs);
    },
    decrement(attrs: Attributes) {
      counter.add(-1, attrs);
    },
  };
}

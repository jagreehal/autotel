/**
 * Grafana Loki subscriber for autotel
 *
 * Pushes events to Loki's push API as JSON log lines under a small,
 * low-cardinality label set. Works against a self-hosted single-tenant
 * instance, a multi-tenant deployment, and Grafana Cloud.
 *
 * The label split is the thing to get right. Loki indexes labels and bills by
 * their cardinality, while the log line itself is searched at query time. This
 * subscriber labels only `service`, `environment` and `level` by default and
 * leaves everything else — request ids, paths, user ids, your own attributes —
 * in the line, where `| json` reaches them without creating a stream per value.
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 * import { LokiSubscriber } from 'autotel-subscribers/loki';
 *
 * init({
 *   service: 'checkout-api',
 *   eventSubscribers: [
 *     new LokiSubscriber({ endpoint: 'http://localhost:3100' }),
 *   ],
 * });
 * ```
 */

import type {
  EventSubscriber,
  EventAttributes,
  EventTrackingOptions,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';
import { createHttpClient } from './http-client';
import { postJsonWithRetry } from './webhook-delivery';

/** Push path appended to {@link LokiConfig.endpoint}. */
const LOKI_PUSH_PATH = '/loki/api/v1/push';

/**
 * Fields promoted to Loki labels when none are configured. Deliberately short:
 * every distinct combination of label values is a separate stream.
 */
const DEFAULT_LABEL_FIELDS = ['service', 'environment', 'level'] as const;

export interface LokiConfig {
  /**
   * Base URL of the Loki instance, without the push path.
   * Falls back to `LOKI_ENDPOINT`, `LOKI_URL`, then `LOKI_BASE_URL`.
   *
   * @example 'http://localhost:3100'
   * @example 'https://logs-prod-eu-west-0.grafana.net'
   */
  endpoint?: string;

  /**
   * API token. Paired with {@link LokiConfig.user} it is sent as HTTP Basic,
   * which is what Grafana Cloud expects. Alone it is sent as Bearer, which
   * suits an instance behind an authenticating proxy.
   * Falls back to `LOKI_API_KEY`, then `GRAFANA_API_KEY`.
   */
  apiKey?: string;

  /**
   * Grafana Cloud instance ID — the numeric user of the Loki datasource, not
   * an account email. Supplying it switches authentication to Basic.
   * Falls back to `LOKI_USER`, then `GRAFANA_USER`.
   */
  user?: string;

  /**
   * Tenant for multi-tenant self-hosted Loki, sent as `X-Scope-OrgID`.
   * Independent of the auth mode. Falls back to `LOKI_TENANT_ID`.
   */
  tenantId?: string;

  /**
   * Event fields promoted to stream labels.
   * Defaults to `['service', 'environment', 'level']`.
   *
   * Keep this short and bounded. Promoting `requestId` or `userId` creates one
   * stream per value, which degrades and eventually breaks an instance.
   */
  labelFields?: string[];

  /** Static labels merged into every stream, e.g. `{ cluster: 'prod-eu' }`. */
  labels?: Record<string, string>;

  /** Events buffered before a push. Default 100. */
  batchSize?: number;

  /** Milliseconds before a partial batch is pushed anyway. Default 5000. */
  flushIntervalMs?: number;

  /** Request timeout in milliseconds. Default 5000. */
  timeoutMs?: number;

  /** Attempts including the first. Default 3. */
  maxRetries?: number;

  /** Set false to construct the subscriber without sending anything. */
  enabled?: boolean;
}

/** One event as it is written to the Loki line. */
export type LokiEvent = EventAttributes & { timestamp?: string };

interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

export interface LokiPayload {
  streams: LokiStream[];
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/** Resolve the push URL, tolerating an endpoint that already carries the path. */
export function resolveLokiPushUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(LOKI_PUSH_PATH)
    ? trimmed
    : `${trimmed}${LOKI_PUSH_PATH}`;
}

/** Loki entry timestamps are nanosecond epoch strings. */
export function toLokiTimestamp(timestamp?: string): string {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  const ms = Number.isFinite(parsed) ? parsed : Date.now();
  return `${ms}000000`;
}

/**
 * Build the stream labels for one event.
 *
 * Only configured fields holding a string, number or boolean become labels.
 * Objects and arrays are skipped rather than stringified, because a serialised
 * object is exactly the unbounded label value that wrecks a Loki instance.
 */
export function toLokiLabels(
  event: LokiEvent,
  config: Pick<LokiConfig, 'labelFields' | 'labels'> = {},
): Record<string, string> {
  const fields = config.labelFields ?? [...DEFAULT_LABEL_FIELDS];
  const labels = new Map(Object.entries(config.labels ?? {}));

  for (const field of fields) {
    const value = event[field];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      labels.set(field, String(value));
    }
  }

  return Object.fromEntries(labels);
}

/**
 * Group events into streams by label set.
 *
 * Loki rejects a push whose entries run backwards within a stream, so each
 * stream's values are sorted by timestamp before they go out.
 */
export function buildLokiPayload(
  events: LokiEvent[],
  config: Pick<LokiConfig, 'labelFields' | 'labels'> = {},
): LokiPayload {
  const byLabels = new Map<string, LokiStream>();

  for (const event of events) {
    const labels = toLokiLabels(event, config);
    const key = JSON.stringify(
      Object.entries(labels).toSorted(([a], [b]) => a.localeCompare(b)),
    );
    const entry: [string, string] = [
      toLokiTimestamp(
        typeof event.timestamp === 'string' ? event.timestamp : undefined,
      ),
      JSON.stringify(event),
    ];

    const existing = byLabels.get(key);
    if (existing) {
      existing.values.push(entry);
    } else {
      byLabels.set(key, { stream: labels, values: [entry] });
    }
  }

  for (const stream of byLabels.values()) {
    stream.values = stream.values.toSorted(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
  }

  return { streams: [...byLabels.values()] };
}

/** Auth and tenancy headers for a resolved config. */
export function toLokiHeaders(
  config: Pick<LokiConfig, 'apiKey' | 'user' | 'tenantId'>,
): Record<string, string> {
  const headers = new Map<string, string>();

  if (config.user && config.apiKey) {
    const encoded = Buffer.from(`${config.user}:${config.apiKey}`).toString(
      'base64',
    );
    headers.set('Authorization', `Basic ${encoded}`);
  } else if (config.apiKey) {
    headers.set('Authorization', `Bearer ${config.apiKey}`);
  }

  if (config.tenantId) headers.set('X-Scope-OrgID', config.tenantId);

  return Object.fromEntries(headers);
}

/** Push a batch of events without going through a subscriber. */
export async function sendBatchToLoki(
  events: LokiEvent[],
  config: LokiConfig = {},
): Promise<void> {
  if (events.length === 0) return;

  const endpoint =
    config.endpoint ?? firstEnv('LOKI_ENDPOINT', 'LOKI_URL', 'LOKI_BASE_URL');
  if (!endpoint) throw new Error('Loki endpoint is not configured');

  const resolved: LokiConfig = {
    ...config,
    endpoint,
    apiKey: config.apiKey ?? firstEnv('LOKI_API_KEY', 'GRAFANA_API_KEY'),
    user: config.user ?? firstEnv('LOKI_USER', 'GRAFANA_USER'),
    tenantId: config.tenantId ?? firstEnv('LOKI_TENANT_ID'),
  };

  const client = createHttpClient({ timeoutMs: resolved.timeoutMs ?? 5000 });
  await postJsonWithRetry(
    client,
    resolveLokiPushUrl(endpoint),
    buildLokiPayload(events, resolved),
    {
      headers: toLokiHeaders(resolved),
      maxRetries: resolved.maxRetries ?? 3,
      label: 'Loki',
    },
  );
}

/** Push a single event without going through a subscriber. */
export async function sendToLoki(
  event: LokiEvent,
  config: LokiConfig = {},
): Promise<void> {
  await sendBatchToLoki([event], config);
}

/**
 * Buffers events and pushes them to Loki as grouped streams.
 *
 * Batching is not an optimisation here so much as the shape Loki wants: one
 * request carrying several streams costs far less than one request per event,
 * and grouping is what lets entries be ordered within a stream.
 */
export class LokiSubscriber implements EventSubscriber {
  readonly name = 'LokiSubscriber';
  readonly version = '1.0.0';

  private readonly config: LokiConfig;
  private readonly endpoint: string | undefined;
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly httpClient;
  private buffer: LokiEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Set<Promise<void>>();
  private warnedMissingEndpoint = false;

  constructor(config: LokiConfig = {}) {
    this.endpoint =
      config.endpoint ?? firstEnv('LOKI_ENDPOINT', 'LOKI_URL', 'LOKI_BASE_URL');

    this.config = {
      ...config,
      apiKey: config.apiKey ?? firstEnv('LOKI_API_KEY', 'GRAFANA_API_KEY'),
      user: config.user ?? firstEnv('LOKI_USER', 'GRAFANA_USER'),
      tenantId: config.tenantId ?? firstEnv('LOKI_TENANT_ID'),
    };

    this.enabled = config.enabled ?? true;
    this.batchSize = config.batchSize ?? 100;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.httpClient = createHttpClient({
      timeoutMs: config.timeoutMs ?? 5000,
    });
  }

  private record(event: LokiEvent): void {
    if (!this.enabled) return;

    // A missing endpoint must never fail the caller's request path. Say so
    // once, then stay quiet.
    if (!this.endpoint) {
      if (!this.warnedMissingEndpoint) {
        this.warnedMissingEndpoint = true;
        console.warn(
          '[autotel/loki] No endpoint configured; set LOKI_ENDPOINT or pass { endpoint }. Events are being dropped.',
        );
      }
      return;
    }

    this.buffer.push(event);

    if (this.buffer.length >= this.batchSize) {
      this.track(this.flush());
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.track(this.flush());
      }, this.flushIntervalMs);
      // Never hold the process open for a partial batch.
      this.timer.unref?.();
    }
  }

  /** Push everything buffered so far. Safe to call when empty. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.endpoint) return;

    const batch = this.buffer;
    this.buffer = [];

    await postJsonWithRetry(
      this.httpClient,
      resolveLokiPushUrl(this.endpoint),
      buildLokiPayload(batch, this.config),
      {
        headers: toLokiHeaders(this.config),
        maxRetries: this.config.maxRetries ?? 3,
        label: 'Loki',
      },
    );
  }

  async trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    this.record({
      type: 'event',
      name,
      ...attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
  }

  async trackFunnelStep(
    funnelName: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    this.record({
      type: 'funnel',
      funnel: funnelName,
      step,
      ...attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
  }

  async trackOutcome(
    operationName: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    this.record({
      type: 'outcome',
      operation: operationName,
      outcome,
      ...attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
  }

  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ): Promise<void> {
    this.record({
      type: 'value',
      name,
      value,
      ...attributes,
      timestamp: new Date().toISOString(),
      autotel: options?.autotel,
    });
  }

  private track(request: Promise<void>): void {
    this.pending.add(request);
    void request
      .catch(() => {})
      .finally(() => {
        this.pending.delete(request);
      });
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending.size > 0) await Promise.allSettled(this.pending);
    await this.flush().catch(() => {});
  }
}

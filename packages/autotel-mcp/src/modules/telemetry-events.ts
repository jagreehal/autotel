/**
 * Telemetry as MCP Events (SEP-3415): what an agent would otherwise have to
 * ask for on a timer, offered as subscriptions so it can be woken instead.
 *
 * - `autotel.issue.opened`: an error nobody has seen before.
 * - `autotel.deploy.detected`: a service started reporting a new
 *   `service.version`, with its error rate and p95 either side.
 *
 * Poll only. The server is stateless (a server per request), so push and
 * webhook, which need a subscription held somewhere, are not offered. Each
 * poll is answered from the backend alone: the cursor is the position checked
 * up to, a timestamp (and the last event id when a batch was cut short), held
 * {@link INDEXING_LAG_MS} behind now so a record the backend indexes late is
 * still ahead of it. The event ids are derived from the upstream facts
 * (an issue fingerprint; a service, its two versions and when it changed),
 * so a client that sees an event twice can drop the copy.
 *
 * Payloads are identifiers and numbers, never error text: an exception
 * message is untrusted input, and the spec asks for enough to triage, with
 * the rest fetched through tools (`get_issue`, `get_trace`).
 *
 * Pure: the caller supplies where issues and spans come from.
 */

import type { Issue } from 'autotel-devtools/issues';
import type { SpanRecord } from '../types';
import { whatChanged } from './span-aggregate';

export const EVENTS_EXTENSION = 'io.modelcontextprotocol/events';

export const ISSUE_OPENED = 'autotel.issue.opened';
export const DEPLOY_DETECTED = 'autotel.deploy.detected';

/** How far back a cursor may reach before the gap is reported instead. */
export const REPLAY_CEILING_MS = 24 * 60 * 60_000;
/** Spans before the window too, so a change at its start has a "before" side. */
export const DEPLOY_BASELINE_MS = 60 * 60_000;
/**
 * How far behind now the cursor stays. A backend indexes a record some time
 * after it happened, so a poll that moved the cursor to now would step past
 * records not yet visible. Two minutes covers the backends autotel-mcp
 * supports; a backend that lags more would need its own value.
 */
export const INDEXING_LAG_MS = 2 * 60_000;
/** Both checks read the backend, so a minute is the cadence they are worth. */
export const NEXT_POLL_MS = 60_000;
/**
 * For a rate-limited backend: Datadog's spans API can allow 5 requests a
 * minute, and one poll of each type costs about six.
 */
export const RATE_LIMITED_POLL_MS = 300_000;
const DEFAULT_MAX_EVENTS = 50;

const serviceArgument = {
  type: 'object',
  properties: {
    service: {
      type: 'string',
      description: 'Only this service (service.name). Omit for every service.',
    },
  },
  additionalProperties: false,
} as const;

/** The event types, as `events/list` describes them. */
export const TELEMETRY_EVENT_TYPES = [
  {
    name: ISSUE_OPENED,
    description:
      'Fires when an error is seen for the first time: a new issue, grouped by fingerprint. Fetch the stack and surrounding logs with get_issue. On backends without stored issues, "first time" means first within the last 24 hours.',
    delivery: ['poll'],
    inputSchema: serviceArgument,
    payloadSchema: {
      type: 'object',
      properties: {
        fingerprint: { type: 'string' },
        service: { type: 'string' },
        errorType: { type: 'string' },
        operation: { type: 'string' },
        firstSeen: { type: 'string', format: 'date-time' },
        occurrences: { type: 'integer' },
        traceId: { type: 'string', description: 'A trace it occurred in.' },
      },
      required: ['fingerprint', 'service', 'firstSeen'],
    },
  },
  {
    name: DEPLOY_DETECTED,
    description:
      "Fires when a service's spans start reporting a different service.version (a new one, or a rollback to an earlier one), with error rate and p95 latency before and after as seen so far. Detected from spans, so it needs no deploy events and works on every backend.",
    delivery: ['poll'],
    inputSchema: serviceArgument,
    payloadSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        fromVersion: { type: 'string' },
        toVersion: { type: 'string' },
        changedAt: { type: 'string', format: 'date-time' },
        errorRateBefore: { type: 'number' },
        errorRateAfter: { type: 'number' },
        p95BeforeMs: { type: 'number' },
        p95AfterMs: { type: 'number' },
      },
      required: ['service', 'fromVersion', 'toVersion', 'changedAt'],
    },
  },
] as const;

const KNOWN = new Set<string>(TELEMETRY_EVENT_TYPES.map((type) => type.name));

export interface TelemetryEventSources {
  /** The interval to recommend. Default {@link NEXT_POLL_MS}. */
  nextPollMs?: number;
  /**
   * Issues seen in `[startMs, endMs]`, with their first-seen time; `capped`
   * when they were grouped from searches that may have left occurrences out.
   */
  issues(query: {
    service?: string;
    startMs: number;
    endMs: number;
  }): Promise<{ items: Issue[]; capped?: boolean }>;
  /**
   * A sample of spans in `[startMs, endMs]` that covers its whole width;
   * `capped` when the sample left spans out.
   */
  spans(query: {
    service?: string;
    startMs: number;
    endMs: number;
  }): Promise<{ items: SpanRecord[]; capped?: boolean }>;
}

/** A poll's arguments as the client sent them, checked before use. */
export interface PollArguments {
  service?: unknown;
}

export interface PollRequest {
  name: string;
  arguments?: PollArguments;
  cursor?: string | null;
  maxAgeMs?: number;
  maxEvents?: number;
}

export interface TelemetryEvent {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, string | number>;
}

export interface PollResult {
  events: TelemetryEvent[];
  cursor: string;
  truncated: boolean;
  hasMore: boolean;
  nextPollMs: number;
}

/** Why a poll was refused, as SEP-3415 names it. */
export class TelemetryEventError extends Error {
  constructor(
    readonly kind: 'NotFound' | 'InvalidParams',
    message: string,
  ) {
    super(message);
  }
}

const CURSOR_PREFIX = 't:';

/** Checked up to `unixMs`; at that instant, up to `eventId` when given. */
interface Cursor {
  unixMs: number;
  eventId?: string;
}

export function encodeCursor(unixMs: number, eventId?: string): string {
  return eventId === undefined
    ? `${CURSOR_PREFIX}${unixMs}`
    : `${CURSOR_PREFIX}${unixMs}:${encodeURIComponent(eventId)}`;
}

function decodeCursor(cursor: string): Cursor {
  const body = cursor.startsWith(CURSOR_PREFIX)
    ? cursor.slice(CURSOR_PREFIX.length)
    : '';
  const colon = body.indexOf(':');
  const digits = colon === -1 ? body : body.slice(0, colon);
  const unixMs = /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
  let eventId: string | undefined;
  try {
    eventId =
      colon === -1 ? undefined : decodeURIComponent(body.slice(colon + 1));
  } catch {
    eventId = '';
  }
  if (!Number.isSafeInteger(unixMs) || unixMs < 0 || eventId === '') {
    throw new TelemetryEventError(
      'InvalidParams',
      'Unrecognised cursor: pass back the cursor a poll returned, or null to start from now.',
    );
  }
  return { unixMs, eventId };
}

function unixMsOf(event: TelemetryEvent): number {
  return Date.parse(event.timestamp);
}

/** Events in order of time, then id, which is the order a cursor walks. */
function compareEvents(a: TelemetryEvent, b: TelemetryEvent): number {
  return (
    unixMsOf(a) - unixMsOf(b) ||
    (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
  );
}

function isAfter(event: TelemetryEvent, cursor: Cursor): boolean {
  const unixMs = unixMsOf(event);
  return (
    unixMs > cursor.unixMs ||
    (unixMs === cursor.unixMs &&
      cursor.eventId !== undefined &&
      event.eventId > cursor.eventId)
  );
}

function iso(unixMs: number): string {
  return new Date(unixMs).toISOString();
}

function issueEvents(issues: Issue[]) {
  return issues.map((issue): TelemetryEvent => {
    const data: TelemetryEvent['data'] = {
      fingerprint: issue.fingerprint,
      service: issue.service,
      firstSeen: iso(issue.firstSeen),
      occurrences: issue.count,
    };
    if (issue.type) data.errorType = issue.type;
    if (issue.operation) data.operation = issue.operation;
    const traceId = issue.sampleTraceIds[0];
    if (traceId) data.traceId = traceId;
    return {
      eventId: `issue:${issue.fingerprint}`,
      name: ISSUE_OPENED,
      timestamp: iso(issue.firstSeen),
      data,
    };
  });
}

function deployEvents(spans: SpanRecord[]) {
  return whatChanged(spans).changes.map((change): TelemetryEvent => ({
    // The time too: A to B, a rollback, then A to B again are two deploys.
    // Each part encoded: a version may contain ':' itself.
    eventId: `deploy:${[change.service, change.from, change.to].map((part) => encodeURIComponent(part)).join(':')}:${change.changedAtUnixMs}`,
    name: DEPLOY_DETECTED,
    // When it was detected, which the cursor walks: a rollback confirmed
    // after a poll passed its first span would otherwise fall behind it.
    timestamp: iso(change.confirmedAtUnixMs),
    data: {
      service: change.service,
      fromVersion: change.from,
      toVersion: change.to,
      changedAt: iso(change.changedAtUnixMs),
      errorRateBefore: change.before.errorRate,
      errorRateAfter: change.after.errorRate,
      p95BeforeMs: change.before.p95Ms,
      p95AfterMs: change.after.p95Ms,
    },
  }));
}

/**
 * One `events/poll`. A null cursor starts from now and returns nothing. A
 * cursor older than the replay ceiling, or than `maxAgeMs` before the newest
 * deliverable instant, is moved up to it and the result says `truncated`,
 * because events before it were skipped; so does a poll whose source was
 * capped (a span sample, or the searches issues were grouped from). Events
 * newer than {@link INDEXING_LAG_MS} wait for a later poll.
 */
export async function pollTelemetryEvents(
  request: PollRequest,
  sources: TelemetryEventSources,
  nowUnixMs = Date.now(),
): Promise<PollResult> {
  if (!KNOWN.has(request.name)) {
    throw new TelemetryEventError(
      'NotFound',
      `No event type ${request.name}. Call events/list for the available ones.`,
    );
  }
  const service = request.arguments?.service;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validating a client's argument at the protocol boundary
  if (service !== undefined && typeof service !== 'string') {
    throw new TelemetryEventError('InvalidParams', 'service must be a string');
  }
  const nextPollMs = sources.nextPollMs ?? NEXT_POLL_MS;
  if (request.cursor === null || request.cursor === undefined) {
    return {
      events: [],
      cursor: encodeCursor(nowUnixMs),
      truncated: false,
      hasMore: false,
      nextPollMs,
    };
  }

  const requested = decodeCursor(request.cursor);
  const settledMs = nowUnixMs - INDEXING_LAG_MS;
  // maxAgeMs counts back from the newest instant a poll delivers, not from
  // now: counted from now, any maxAgeMs inside the lag would leave nothing.
  const floor = Math.max(
    nowUnixMs - REPLAY_CEILING_MS,
    request.maxAgeMs === undefined ? 0 : settledMs - request.maxAgeMs,
  );
  let truncated = requested.unixMs < floor;
  const from: Cursor = truncated ? { unixMs: floor } : requested;
  const quiet = (cursor: Cursor): PollResult => ({
    events: [],
    cursor: encodeCursor(cursor.unixMs, cursor.eventId),
    truncated,
    hasMore: false,
    nextPollMs,
  });
  // At the settled instant itself, a cursor holding an event id is mid-way
  // through events that share it, so there may be more to read.
  if (
    from.unixMs > settledMs ||
    (from.unixMs === settledMs && from.eventId === undefined)
  )
    return quiet(from);

  let found: TelemetryEvent[];
  let capped: boolean | undefined;
  if (request.name === ISSUE_OPENED) {
    const seen = await sources.issues({
      service,
      // A full day, so "first seen" is measured against more than the
      // window being polled.
      startMs: nowUnixMs - REPLAY_CEILING_MS,
      endMs: nowUnixMs,
    });
    found = issueEvents(seen.items);
    capped = seen.capped;
  } else {
    const sample = await sources.spans({
      service,
      startMs: from.unixMs - DEPLOY_BASELINE_MS,
      endMs: nowUnixMs,
    });
    found = deployEvents(sample.items);
    capped = sample.capped;
  }
  // Records the source left out may hold an event this poll steps past.
  if (capped) truncated = true;
  const events = found
    .filter((event) => isAfter(event, from) && unixMsOf(event) <= settledMs)
    .sort(compareEvents);

  const max = Math.max(1, request.maxEvents ?? DEFAULT_MAX_EVENTS);
  if (events.length <= max) {
    return { ...quiet({ unixMs: settledMs }), events };
  }
  // A partial batch ends at the last event returned, id included, so the next
  // poll starts after it even when others share its instant.
  const batch = events.slice(0, max);
  const last = batch.at(-1)!;
  return {
    events: batch,
    cursor: encodeCursor(unixMsOf(last), last.eventId),
    truncated,
    hasMore: true,
    nextPollMs,
  };
}

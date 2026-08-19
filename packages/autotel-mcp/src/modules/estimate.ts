/**
 * What a month of telemetry costs, before and after.
 *
 * "Will this make my observability bill worse?" is the first question anyone
 * asks about adding instrumentation, and until now nothing in autotel could
 * answer it. The arithmetic is not hard — the honesty is: the byte sizes are
 * measured from real serialized records rather than assumed, the rate comes
 * from the caller rather than a table that quietly goes stale, and the result
 * says no saving when there is none.
 *
 * The comparison is the shape of the output, not the volume of work:
 * `before` is the scattered lines a request writes today, `after` is the one
 * canonical log line autotel emits for the same request, plus any spans.
 */

import {
  CANONICAL_LINE_BYTES,
  LOG_LINE_BYTES,
  SPAN_BYTES,
} from './estimate-fixtures';

/**
 * Bad input, named so callers can map it to their own error surface — the CLI
 * turns it into an `AUTOTEL_E_INVALID_INPUT` envelope, the MCP tool into a
 * tool error. This module stays free of either.
 */
export class EstimateInputError extends Error {
  readonly field: string;
  readonly expected: string;

  constructor(field: string, expected: string, message: string) {
    super(message);
    this.name = 'EstimateInputError';
    this.field = field;
    this.expected = expected;
  }
}

/** Vendors bill in decimal gigabytes, not gibibytes. */
const BYTES_PER_GB = 1_000_000_000;

export interface EstimateBytes {
  /** One scattered log line, serialized with its envelope. */
  logLine?: number;
  /** One canonical log line: the whole request as a single wide event. */
  canonicalLine?: number;
  /** One exported span. */
  span?: number;
}

export interface EstimateInput {
  /** Requests the application serves per month. */
  requestsPerMonth: number;
  /** Log lines written per request today, before canonical log lines. */
  logLinesPerRequest?: number;
  /** Spans exported per request after instrumenting. */
  spansPerRequest?: number;
  /** Traffic kept after sampling, 1–100. Applied to both shapes. */
  keepPercent?: number;
  /** USD per gigabyte ingested. Required — this tool does not invent rates. */
  perGb: number;
  /** USD per million events indexed. Zero for providers that only meter bytes. */
  perMillionEvents?: number;
  /** Override the measured byte sizes with your own. */
  bytes?: EstimateBytes;
}

export interface EstimateShape {
  events: number;
  gb: number;
  cost: number;
}

export interface EstimateResult {
  currency: 'USD';
  before: EstimateShape;
  after: EstimateShape;
  saved: number;
  savedPercent: number;
  basis: {
    logLineBytes: number;
    canonicalLineBytes: number;
    spanBytes: number;
    /** `measured` when the defaults were used, `caller` when overridden. */
    bytesFrom: 'measured' | 'caller';
    perGb: number;
    perMillionEvents: number;
    keepPercent: number;
    bytesPerGb: number;
  };
}

/** Round money to the cent; round ratios to two places. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function requirePositive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new EstimateInputError(
      field,
      'positive number',
      `${field} must be a positive number`,
    );
  }
  return value;
}

export function estimateCost(input: EstimateInput): EstimateResult {
  const requests = requirePositive(input.requestsPerMonth, 'requestsPerMonth');
  const perGb = requirePositive(input.perGb, 'perGb');

  const perMillionEvents = input.perMillionEvents ?? 0;
  const logLinesPerRequest = input.logLinesPerRequest ?? 4;
  const spansPerRequest = input.spansPerRequest ?? 0;
  const keepPercent = input.keepPercent ?? 100;

  if (keepPercent <= 0 || keepPercent > 100) {
    throw new EstimateInputError(
      'keepPercent',
      '1..100',
      'keepPercent must be between 1 and 100',
    );
  }

  const logLineBytes = input.bytes?.logLine ?? LOG_LINE_BYTES;
  const canonicalLineBytes = input.bytes?.canonicalLine ?? CANONICAL_LINE_BYTES;
  const spanBytes = input.bytes?.span ?? SPAN_BYTES;

  // Sampling is applied to both shapes. Any logger can drop events, so letting
  // it fall on one side would flatter the comparison rather than describe it.
  const kept = requests * (keepPercent / 100);

  const priceOf = (events: number, bytes: number): EstimateShape => {
    const gb = bytes / BYTES_PER_GB;
    return {
      events,
      gb: round(gb),
      cost: round(gb * perGb + (events / 1_000_000) * perMillionEvents),
    };
  };

  const beforeEvents = kept * logLinesPerRequest;
  const before = priceOf(beforeEvents, beforeEvents * logLineBytes);

  const afterEvents = kept + kept * spansPerRequest;
  const after = priceOf(
    afterEvents,
    kept * canonicalLineBytes + kept * spansPerRequest * spanBytes,
  );

  const saved = round(before.cost - after.cost);

  return {
    currency: 'USD',
    before,
    after,
    saved,
    savedPercent: before.cost > 0 ? round((saved / before.cost) * 100) : 0,
    basis: {
      logLineBytes,
      canonicalLineBytes,
      spanBytes,
      bytesFrom: input.bytes ? 'caller' : 'measured',
      perGb,
      perMillionEvents,
      keepPercent,
      bytesPerGb: BYTES_PER_GB,
    },
  };
}

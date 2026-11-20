import { exactInstant, isEpochSeconds } from './validate.js';
import { durationMs, type DataContract, type SlaProperty } from './contract.js';
import type { SlaResult } from './profile.js';

export type MeasurableSla = SlaProperty & {
  element: string;
  propertyName: string;
  limitMs: number;
  /** Why it cannot be measured; its result is `unknown`, never a pass. */
  error?: string;
  /** An SLA kind this tool does not measure; its result is `not-executable`. */
  skipped?: string;
};

const MEASURED = new Set(['freshness', 'retention']);

/**
 * Every SLA that bears on this object, none dropped. Freshness and retention
 * are measured on their element (`object.property`, else slaDefaultElement);
 * one with no element, or an element naming no schema object, bears on every
 * object and comes back with `error`, as does one naming a missing property
 * or an unreadable unit. Other kinds (latency, availability) come back
 * `skipped`. A promise skipped in silence would read as kept.
 */
export function slasFor(
  contract: DataContract,
  object: string,
): MeasurableSla[] {
  const out: MeasurableSla[] = [];
  const objects = new Map((contract.schema ?? []).map((o) => [o.name, o]));
  for (const sla of contract.slaProperties ?? []) {
    const element = sla.element ?? contract.slaDefaultElement;
    const [objName, propertyName = ''] =
      typeof element === 'string' ? element.split('.') : [];
    const target = objName === undefined ? undefined : objects.get(objName);
    if (target && objName !== object) continue; // bears on another object
    const base = {
      ...sla,
      element: typeof element === 'string' ? element : '',
      propertyName,
      limitMs: Number.NaN,
    };
    if (!MEASURED.has(sla.property)) {
      out.push({
        ...base,
        skipped: `${sla.property} is not measured from the data`,
      });
      continue;
    }
    let error: string | undefined;
    if (typeof element !== 'string')
      error = 'no element and no slaDefaultElement: nothing to measure on';
    else if (!target) error = `${element} names no schema object`;
    else if (!target.properties?.some((p) => p.name === propertyName))
      error = `${element} names no property`;
    const limitMs =
      sla.unit === undefined ? undefined : durationMs(sla.value, sla.unit);
    if (error) out.push({ ...base, error });
    else if (limitMs === undefined)
      out.push({
        ...base,
        error: `cannot read ${JSON.stringify(sla.value)} ${sla.unit ?? '(no unit)'} as a duration`,
      });
    else out.push({ ...base, limitMs });
  }
  return out;
}

/** A timestamp value as epoch ms: Date, ISO text, or epoch seconds/ms. */
export function toEpochMs(value: unknown): number | undefined {
  const ms = epochMs(value);
  // NaN, Infinity and an invalid Date are no time at all: unreadable.
  return ms !== undefined && Number.isFinite(ms) ? ms : undefined;
}

function epochMs(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'bigint') {
    const n = Number(value);
    return isEpochSeconds(value) ? n * 1000 : n;
  }
  // The bounds' reading of text, leap seconds included (Date.parse rejects :60).
  const at = typeof value === 'string' ? exactInstant(value) : undefined;
  return at && Number((at.digits * 1000n) / 10n ** BigInt(at.scale));
}

/** How far ahead of this clock a timestamp may be and still count. Default 5 minutes. */
export const DEFAULT_CLOCK_SKEW_MS = 300_000;

/** A timestamp a freshness watermark may take: one not beyond `now + skew`. */
export function usableTimestamp(
  t: number | undefined,
  now: number,
  skewMs = DEFAULT_CLOCK_SKEW_MS,
): number | undefined {
  return t !== undefined && t <= now + skewMs ? t : undefined;
}

/**
 * Freshness is kept when the newest value is younger than the limit;
 * retention when the oldest value is younger than the limit. A value further
 * in the future than the clock-skew allowance cannot be measured against
 * (its age is negative, so it would keep any promise): the result is an
 * error, which leaves a report incomplete rather than passed.
 */
export function measureSla(
  sla: {
    property: string;
    element?: string;
    limitMs: number;
    error?: string;
    skipped?: string;
  },
  newest: number | undefined,
  oldest: number | undefined,
  now: number,
  skewMs = DEFAULT_CLOCK_SKEW_MS,
  /** Some value present in the element could not be read as a time. */
  unreadable = false,
): SlaResult {
  const base = {
    property: sla.property,
    element: sla.element ?? '',
    limitMs: sla.limitMs,
  };
  const unknown = (error: string): SlaResult => ({
    ...base,
    status: 'unknown',
    passed: false,
    error,
  });
  if (sla.skipped)
    return {
      ...base,
      status: 'not-executable',
      passed: false,
      error: sla.skipped,
    };
  if (sla.error) return unknown(sla.error);
  const at = sla.property === 'freshness' ? newest : oldest;
  if (at !== undefined && at > now + skewMs)
    return unknown('value is later than now plus the clock-skew allowance');
  if (at === undefined && unreadable)
    return unknown('the element holds values, but none reads as a time');
  const observedMs = at === undefined ? undefined : Math.max(0, now - at);
  // No data at all breaks a freshness promise; it cannot break retention.
  const kept =
    observedMs === undefined
      ? sla.property !== 'freshness'
      : observedMs <= sla.limitMs;
  // Retention covers every value kept: one that does not read as a time
  // could be the oldest, so it overturns a pass (a readable breach stands).
  // Freshness needs evidence, and an unreadable value is none: it never
  // overturns a breach.
  if (unreadable && kept && sla.property === 'retention')
    return {
      ...unknown(
        'a value in the element does not read as a time and could be the oldest',
      ),
      observedMs,
    };
  return {
    ...base,
    observedMs,
    status: kept ? 'kept' : 'breached',
    passed: kept,
  };
}

/**
 * Runtime: check records as they flow (a Kafka handler, an API response, an
 * ETL step) and turn every check into telemetry.
 *
 * The track record ("freshness kept on 29 of the last 30 days") is one
 * outcome per window, not one per record: a stopped feed has no records to
 * check, and a busy hour would outvote a quiet day. So freshness is a
 * scheduled check (`guard.checkSla()` or `slaIntervalMs`) over the newest
 * record seen, which records `breached` when nothing arrived. Scheduled
 * database audits feed the same instruments through `recordReports()`.
 *
 * Values never reach telemetry, and neither do keys the payload chose: field
 * paths come from the contract (`schemaPath`), with `(undeclared)` for any
 * key it does not name, so neither cardinality nor personal data is decided
 * by the sender.
 */
import {
  logs,
  metrics,
  SeverityNumber,
  trace,
  type Attributes,
} from '@opentelemetry/api';
import { findObject, type DataContract } from './contract.js';
import type { CheckReport, SlaResult } from './profile.js';
import { measureSla, slasFor, toEpochMs, usableTimestamp } from './sla.js';
import {
  validateRecord,
  type ValidateOptions,
  type Violation,
} from './validate.js';

export const DATACONTRACT_ATTRS = {
  id: 'datacontract.id',
  version: 'datacontract.version',
  object: 'datacontract.object',
  outcome: 'datacontract.outcome',
  code: 'datacontract.violation.code',
  property: 'datacontract.violation.property',
  severity: 'datacontract.violation.severity',
  violations: 'datacontract.violations',
  sla: 'datacontract.sla',
  rule: 'datacontract.rule',
} as const;

/** Most violation events per record; the counters stay exact. */
const MAX_EVENTS = 20;

export interface GuardOptions extends ValidateOptions {
  /** Schema object the records belong to. */
  object: string;
  /**
   * `record` (default) reports and returns; `throw` also throws
   * ContractViolationError on an error-level violation, for a quarantine
   * step that must hold bad data back.
   */
  mode?: 'record' | 'throw';
  /** Called with every record that has violations. */
  onViolation?: (violations: Violation[], record: unknown) => void;
  /**
   * Run `checkSla()` on this interval (ms). The timer is unref'd. Run it in
   * one process per dataset: every replica that runs it records its own
   * outcome per window.
   */
  slaIntervalMs?: number;
  /** Clock, epoch ms. Default Date.now. */
  now?: () => number;
  /**
   * How far in the future a freshness timestamp may be and still advance the
   * watermark (clock skew between producer and this process). Default 5 min.
   */
  maxClockSkewMs?: number;
}

export class ContractViolationError extends Error {
  constructor(
    readonly contractId: string,
    readonly object: string,
    readonly violations: Violation[],
  ) {
    super(
      `${contractId}/${object}: ${violations
        .filter((v) => v.severity === 'error')
        .map((v) => `${v.schemaPath} ${v.code}`)
        .join(', ')}`,
    );
    this.name = 'ContractViolationError';
  }
}

export interface ContractGuard {
  /** Validate one record, record the outcome, and return its violations. */
  check(record: unknown): Violation[];
  /**
   * Record one freshness outcome per SLA from the newest record seen so far:
   * `breached` when none has arrived, or the newest is older than the limit.
   */
  checkSla(): SlaResult[];
  /** Stop the `slaIntervalMs` timer. */
  stop(): void;
}

function instruments() {
  const meter = metrics.getMeter('autotel-datacontract');
  return {
    records: meter.createCounter('datacontract.records', {
      description: 'Records checked against a data contract, by outcome',
    }),
    violations: meter.createCounter('datacontract.violations', {
      description: 'Data contract violations, by rule and contract path',
    }),
    slaChecks: meter.createCounter('datacontract.sla.checks', {
      description:
        'Scheduled service-level checks, one per SLA per window, by outcome',
    }),
    qualityChecks: meter.createCounter('datacontract.quality.checks', {
      description: 'Quality rule results from scheduled audits, by outcome',
    }),
    audits: meter.createCounter('datacontract.audits', {
      description: 'Scheduled contract audits, by status',
    }),
    age: meter.createHistogram('datacontract.freshness.age', {
      unit: 's',
      description:
        'Age of the freshness element: at arrival per record, and of the newest record per scheduled check',
    }),
  };
}

const baseAttrs = (contract: DataContract, object: string): Attributes => ({
  [DATACONTRACT_ATTRS.id]: contract.id,
  [DATACONTRACT_ATTRS.version]: contract.version,
  [DATACONTRACT_ATTRS.object]: object,
});

export function createContractGuard(
  contract: DataContract,
  options: GuardOptions,
): ContractGuard {
  const obj = findObject(contract, options.object);
  const m = instruments();
  const logger = logs.getLogger('autotel-datacontract');
  const base = baseAttrs(contract, obj.name);
  const slas = slasFor(contract, obj.name).filter(
    (s) => s.property === 'freshness',
  );
  const newest = new Map<string, number>();
  const unusable = new Set<string>();
  const now = () => (options.now ?? Date.now)();

  const checkSla = (): SlaResult[] =>
    slas.map((sla) => {
      const seen = newest.get(sla.propertyName);
      const result = measureSla(
        sla,
        seen,
        undefined,
        now(),
        options.maxClockSkewMs,
        seen === undefined && unusable.has(sla.propertyName),
      );
      if (result.observedMs !== undefined)
        m.age.record(Math.max(0, result.observedMs / 1000), {
          ...base,
          [DATACONTRACT_ATTRS.sla]: 'freshness',
        });
      m.slaChecks.add(1, {
        ...base,
        [DATACONTRACT_ATTRS.sla]: 'freshness',
        [DATACONTRACT_ATTRS.outcome]:
          result.status === 'kept' || result.status === 'breached'
            ? result.status
            : 'unknown',
      });
      return result;
    });

  const timer = options.slaIntervalMs
    ? setInterval(checkSla, options.slaIntervalMs)
    : undefined;
  timer?.unref?.();

  return {
    checkSla,
    stop: () => clearInterval(timer),
    check(record) {
      const found = validateRecord(contract, obj, record, options);
      const failed = found.some((v) => v.severity === 'error');
      const outcome = failed ? 'invalid' : found.length ? 'variant' : 'valid';
      m.records.add(1, { ...base, [DATACONTRACT_ATTRS.outcome]: outcome });
      for (const v of found)
        m.violations.add(1, {
          ...base,
          [DATACONTRACT_ATTRS.code]: v.code,
          [DATACONTRACT_ATTRS.property]: v.schemaPath,
        });

      // Only a record that keeps its promises is evidence the data is fresh: a
      // rejected one (quarantined in throw mode) must not move the watermark,
      // and neither may a timestamp beyond the clock-skew allowance.
      if (!failed && typeof record === 'object' && record !== null) {
        const at = now();
        for (const sla of slas) {
          const t = usableTimestamp(
            toEpochMs((record as Record<string, unknown>)[sla.propertyName]),
            at,
            options.maxClockSkewMs,
          );
          if (t === undefined) {
            const raw = (record as Record<string, unknown>)[sla.propertyName];
            if (raw !== null && raw !== undefined)
              unusable.add(sla.propertyName);
            continue;
          }
          if (t > (newest.get(sla.propertyName) ?? -Infinity))
            newest.set(sla.propertyName, t);
          m.age.record(Math.max(0, (at - t) / 1000), base);
        }
      }

      // Every key, every check: a span that checks several records shows the
      // last one, never one record's outcome with another's count.
      trace.getActiveSpan()?.setAttributes({
        ...base,
        [DATACONTRACT_ATTRS.outcome]: outcome,
        [DATACONTRACT_ATTRS.violations]: found.length,
      });
      // OpenTelemetry events through the Logs API, correlated to the active span (as autotel's ctx.event).
      for (const v of found.slice(0, MAX_EVENTS)) {
        const attributes = {
          ...base,
          [DATACONTRACT_ATTRS.code]: v.code,
          [DATACONTRACT_ATTRS.property]: v.schemaPath,
          [DATACONTRACT_ATTRS.severity]: v.severity,
        };
        logger.emit({
          eventName: 'datacontract.violation',
          body: 'datacontract.violation',
          severityNumber:
            v.severity === 'error' ? SeverityNumber.WARN : SeverityNumber.INFO,
          severityText: v.severity === 'error' ? 'WARN' : 'INFO',
          attributes: { ...attributes, 'event.name': 'datacontract.violation' },
        });
      }

      if (found.length) options.onViolation?.(found, record);
      if (failed && options.mode === 'throw')
        throw new ContractViolationError(contract.id, obj.name, found);
      return found;
    },
  };
}

/**
 * Record scheduled audit results (`auditDatabase`, `checkRecords` over a
 * nightly export) as the contract's track record: one `datacontract.audits`
 * per report, one `datacontract.quality.checks` per rule and one
 * `datacontract.sla.checks` per SLA. Run it once per window.
 */
export function recordReports(
  contract: DataContract,
  reports: CheckReport | CheckReport[],
): void {
  const m = instruments();
  for (const r of Array.isArray(reports) ? reports : [reports]) {
    const base = baseAttrs(contract, r.object);
    m.audits.add(1, { ...base, [DATACONTRACT_ATTRS.outcome]: r.status });
    for (const q of r.quality) {
      if (q.status === 'not-executable') continue;
      // The rule's own words are prose; its metric and property are contract terms.
      const rule = q.property ? `${q.property}:${q.metric}` : q.metric;
      m.qualityChecks.add(1, {
        ...base,
        [DATACONTRACT_ATTRS.rule]: rule,
        [DATACONTRACT_ATTRS.outcome]: q.status,
      });
    }
    for (const s of r.sla) {
      if (s.observedMs !== undefined)
        m.age.record(Math.max(0, s.observedMs / 1000), {
          ...base,
          [DATACONTRACT_ATTRS.sla]: s.property,
        });
      if (s.status === 'not-executable') continue;
      m.slaChecks.add(1, {
        ...base,
        [DATACONTRACT_ATTRS.sla]: s.property,
        [DATACONTRACT_ATTRS.outcome]: s.status,
      });
    }
  }
}

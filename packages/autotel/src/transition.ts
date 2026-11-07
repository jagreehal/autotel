/**
 * Evidence that an entity moved between two states.
 *
 * In most systems a state change is a status write in a database, not an event.
 * `transition()` records one such write, and it has to hold up in production,
 * where only a small share of traces is kept. So the counter is the primary
 * signal: it is recorded on every call, whatever the sampling decision and
 * whether or not a span is active. The span event is a convenience for the
 * traces that are kept.
 *
 * ## What it means
 *
 * Call it after the write succeeded, and only when a document actually changed.
 * It records a persisted transition. An attempt is not this signal: a write that
 * failed, or matched nothing, changed no state.
 *
 * ## Cardinality
 *
 * The entity id never reaches the metric. A per-instance attribute would create
 * a time series per document. `entity`, `field`, `from`, `to` and `via` are
 * metric attributes, so each needs to be a small fixed vocabulary.
 *
 * Counts are best-effort evidence, not an authoritative number: metrics are
 * lost with a process that dies before its next export.
 */

import {
  trace,
  type Attributes,
  type Counter,
  type Meter,
  logs,
  SeverityNumber,
} from '@opentelemetry/api';
import { getConfig as getRuntimeConfig } from './config';
import { getConfig, getLogger, isInitialized } from './init';
import { track } from './track';

/** The counter every transition increments. */
export const STATE_TRANSITIONS_METRIC = 'autotel.state.transitions';

/** The span event, subscriber event and log record name of one transition. */
export const STATE_TRANSITION_EVENT = 'state.transition';

/** Canonical `state.*` attribute keys. */
export const STATE_ATTRIBUTE = {
  ENTITY: 'state.entity',
  FIELD: 'state.field',
  FROM: 'state.from',
  TO: 'state.to',
  VIA: 'state.via',
  /** Never on the metric. See {@link TransitionInput.history}. */
  ID: 'state.id',
} as const;

export interface TransitionInput {
  /** The kind of thing that changed, e.g. `order`. */
  entity: string;
  /** The field holding its state, e.g. `status`. */
  field: string;
  /** The state before the write, e.g. `pending`. */
  from: string;
  /** The state after the write, e.g. `paid`. */
  to: string;
  /** The business operation that made the change. Defaults to `unknown`. */
  via?: string;
  /** This instance's id. Only `history: true` records it. */
  id?: string;
  /**
   * With `id`, also emit a `state.transition` log record carrying `state.id`,
   * and put the id on the span event. One instance's history then lives in the
   * log backend, under that backend's access control. Needs log export
   * configured in `init()`; without it the record goes nowhere.
   */
  history?: boolean;
}

let instrument: { meter: Meter; counter: Counter } | undefined;
let warned = false;

/**
 * The counter for the current meter. The meter is a no-op until `init()` runs
 * and changes with each `init()`, so a counter is only good for the meter that
 * made it.
 */
function transitionCounter(): Counter {
  const { meter } = getRuntimeConfig();
  if (instrument?.meter !== meter) {
    instrument = {
      meter,
      counter: meter.createCounter(STATE_TRANSITIONS_METRIC, {
        description: 'Persisted state transitions, by entity and field',
        unit: '1',
      }),
    };
  }
  return instrument.counter;
}

/**
 * Run one signal so that its failure neither reaches the caller's write path
 * nor costs the others. Warns once per process, since the alternative is a line
 * per write.
 */
function guarded(record: () => void): void {
  try {
    record();
  } catch (error) {
    if (warned) return;
    warned = true;
    try {
      getLogger().warn(
        { err: error },
        '[autotel] transition() failed to record a signal',
      );
    } catch {
      // A logger that throws has nothing left to report through.
    }
  }
}

function attributesOf(input: TransitionInput): Attributes {
  const { entity, field, from, to, via } = input;
  for (const value of [entity, field, from, to]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        'transition() needs entity, field, from and to as non-empty strings',
      );
    }
  }
  return {
    [STATE_ATTRIBUTE.ENTITY]: entity,
    [STATE_ATTRIBUTE.FIELD]: field,
    [STATE_ATTRIBUTE.FROM]: from,
    [STATE_ATTRIBUTE.TO]: to,
    [STATE_ATTRIBUTE.VIA]: via || 'unknown',
  };
}

/**
 * Record that an entity's state changed. Never throws.
 *
 * Call it after the write succeeded, and only when a document actually changed.
 *
 * @example
 * ```typescript
 * const { modifiedCount } = await orders.updateOne(
 *   { _id: id, status: 'pending' },
 *   { $set: { status: 'paid' } },
 * );
 * if (modifiedCount === 1) {
 *   transition({
 *     entity: 'order',
 *     field: 'status',
 *     from: 'pending',
 *     to: 'paid',
 *     via: 'checkout',
 *   });
 * }
 * ```
 */
export function transition(input: TransitionInput): void {
  guarded(() => {
    const attributes = attributesOf(input);
    const identified =
      input.history === true && input.id
        ? { ...attributes, [STATE_ATTRIBUTE.ID]: input.id }
        : undefined;

    guarded(() => transitionCounter().add(1, attributes));

    guarded(() => {
      const span = trace.getActiveSpan();
      if (span?.isRecording()) {
        span.addEvent(STATE_TRANSITION_EVENT, identified ?? attributes);
      }
    });

    if (identified) {
      guarded(() =>
        logs.getLogger('autotel').emit({
          eventName: STATE_TRANSITION_EVENT,
          body: STATE_TRANSITION_EVENT,
          severityNumber: SeverityNumber.INFO,
          severityText: 'INFO',
          attributes: identified,
        }),
      );
    }

    // Subscribers see the id-free attributes. track() warns when nothing is
    // listening, which is the normal case here, so it is only called when
    // something is.
    guarded(() => {
      if (isInitialized() && getConfig()?.subscribers?.length) {
        track(STATE_TRANSITION_EVENT, attributes);
      }
    });
  });
}

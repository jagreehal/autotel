import {
  context,
  type Attributes,
  type Context,
  type Exception,
  type HrTime,
  type Span,
  type SpanOptions,
  type TimeInput,
  type Tracer,
} from '@opentelemetry/api';
import {
  hrTimeToMilliseconds,
  isTimeInput,
  millisToHrTime,
} from '@opentelemetry/core';
import { readProperty } from './values';

/** The callback OpenTelemetry's `Tracer.startActiveSpan` takes; its result passes through unread. */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- Mirrors OpenTelemetry's Tracer signature, which these tracers implement.
export type SpanCallback = (span: Span) => unknown;

/** A wall-clock time paired with the `performance.now()` read at that moment. */
interface ClockAnchor {
  wallMs: number;
  perfMs: number;
}

let anchor: ClockAnchor | undefined;

/**
 * Wall-clock time in milliseconds, finer than `Date.now()`.
 *
 * OpenTelemetry JS stamps a span's start with `Date.now()`, whole
 * milliseconds, so spans that begin within one millisecond share a start and
 * a waterfall draws them on top of one another. This adds the sub-millisecond
 * part from `performance.now()`, measured from an anchor that resets whenever
 * the two clocks drift a millisecond apart, so the result stays within a
 * millisecond of `Date.now()` however long the process runs.
 */
export function preciseNow(): number {
  const wallMs = Date.now();
  const perfMs = performance.now();
  if (
    !anchor ||
    Math.abs(anchor.wallMs + (perfMs - anchor.perfMs) - wallMs) >= 1
  ) {
    anchor = { wallMs, perfMs };
  }
  return anchor.wallMs + (perfMs - anchor.perfMs);
}

const preciseHrTime = (): HrTime => millisToHrTime(preciseNow());

/**
 * Give a span started at `start` precise default times for its end and
 * events.
 *
 * A span given a `startTime` stamps its end and events with `Date.now()`,
 * whole milliseconds. Supplying {@link preciseNow} wherever the caller left
 * the time out keeps them on the same clock as the start.
 *
 * Events a span processor added in `onStart` without a time were stamped
 * `Date.now()` before this ran: the whole millisecond the span started in,
 * which can fall a fraction before `start`. Only events at exactly that
 * millisecond move up to the start; any other time was chosen by its caller
 * and is kept.
 */
function usePreciseTimes(span: Span, start: HrTime): void {
  if (!span.isRecording()) return;
  const events = readProperty(span, 'events');
  if (Array.isArray(events)) {
    const startMs = hrTimeToMilliseconds(start);
    const startedInMs = Math.floor(startMs);
    for (const event of events) {
      const time = readProperty(event, 'time');
      // SAFETY: an SDK event's time is the HrTime pair the SDK stamped.
      const eventMs = Array.isArray(time)
        ? hrTimeToMilliseconds(time as HrTime)
        : undefined;
      if (eventMs === startedInMs && eventMs < startMs)
        Object.assign(event, { time: start });
    }
  }
  const { end, addEvent, recordException } = span;
  Object.assign(span, {
    end: (endTime?: TimeInput) => end.call(span, endTime ?? preciseHrTime()),
    addEvent: (
      name: string,
      attributesOrTime?: Attributes | TimeInput,
      time?: TimeInput,
    ) =>
      isTimeInput(attributesOrTime) || time !== undefined
        ? addEvent.call(span, name, attributesOrTime, time)
        : addEvent.call(span, name, attributesOrTime, preciseHrTime()),
    recordException: (exception: Exception, time?: TimeInput) =>
      recordException.call(span, exception, time ?? preciseHrTime()),
  });
}

/** `tracer`, starting each span at {@link preciseNow} unless told otherwise. */
export class PreciseStartTracer implements Tracer {
  constructor(private readonly tracer: Tracer) {}

  startSpan(name: string, options?: SpanOptions, ctx?: Context): Span {
    if (options?.startTime !== undefined)
      return this.tracer.startSpan(name, options, ctx);
    const startTime = preciseHrTime();
    const span = this.tracer.startSpan(name, { ...options, startTime }, ctx);
    usePreciseTimes(span, startTime);
    return span;
  }

  startActiveSpan<F extends SpanCallback>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends SpanCallback>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends SpanCallback>(
    name: string,
    options: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends SpanCallback>(
    name: string,
    ...rest: [F] | [SpanOptions, F] | [SpanOptions, Context, F]
  ): ReturnType<F> {
    const given = rest.length === 1 ? {} : rest[0];
    const startTime = preciseHrTime();
    const options =
      given.startTime === undefined ? { ...given, startTime } : given;
    const ctx = rest.length === 3 ? rest[1] : context.active();
    const fn = rest.at(-1);
    // SAFETY: the last argument of every overload is the callback F.
    const callback = fn as F;
    const result = this.tracer.startActiveSpan<SpanCallback>(
      name,
      options,
      ctx,
      (span) => {
        if (given.startTime === undefined) usePreciseTimes(span, startTime);
        return callback(span);
      },
    );
    // SAFETY: `result` is what `callback` returned, passed straight through by the SDK.
    return result as ReturnType<F>;
  }
}

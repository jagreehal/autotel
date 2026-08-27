/**
 * Record which experiment a unit of work is part of.
 *
 * An experiment needs a guess and a way to check it. Instrumentation gives you
 * the check; this names the guess, so the two cohorts you want to compare are
 * selectable from the telemetry rather than reconstructed by hand afterwards.
 */
import { getActiveTraceContext } from './functional';

export interface ExperimentOptions {
  /** Stable name for the experiment, shared by every variant. */
  name: string;
  /** Which arm of the experiment this call took. */
  variant: string;
  /** What you expect this variant to do, in your own words. */
  expect?: string;
}

export function experiment(options: ExperimentOptions): void {
  const ctx = getActiveTraceContext();
  if (!ctx) return;
  ctx.setAttribute('experiment.name', options.name);
  ctx.setAttribute('experiment.variant', options.variant);
  if (options.expect !== undefined) {
    ctx.setAttribute('experiment.expectation', options.expect);
  }
  // Baggage, so the rest of the unit of work carries the same answer: child
  // spans started after this call, and the services it goes on to reach.
  ctx.setBaggage('experiment.name', options.name);
  ctx.setBaggage('experiment.variant', options.variant);
}

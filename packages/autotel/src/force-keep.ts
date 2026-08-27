import { getActiveTraceContext } from './functional';
import { getActiveSpan } from './trace-helpers';
import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
  markForceKept,
} from './sampling';

/**
 * Keep this trace whatever the sampler decides.
 *
 * Reach for it where a trace is worth more than the sampling budget: a
 * payment, an audit-relevant action, or a request you are debugging now.
 */
export function forceKeep(): void {
  const ctx = getActiveTraceContext();
  if (!ctx) return;
  ctx.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
  ctx.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
  const span = getActiveSpan();
  if (span) markForceKept(span);
}

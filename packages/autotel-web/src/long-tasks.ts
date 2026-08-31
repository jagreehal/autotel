/**
 * Main-thread jank.
 *
 * A long task is the browser telling you the page stopped responding for a
 * while. OpenTelemetry already names this signal `app.jank`, so that is what
 * this emits — the same observation a mobile SDK reports, under the same name,
 * so one dashboard covers both.
 */

import { emitEvent } from './emit-event';
import { APP, WEB_EVENT } from './semconv';

/**
 * The browser reports a task as long past 50ms. Expressed in **seconds**,
 * because `app.jank.threshold` and `app.jank.period` are documented in seconds
 * — recording 50 there would claim a fifty-second frame budget.
 */
const LONG_TASK_THRESHOLD_SECONDS = 0.05;

export interface LongTasksConfig {
  debug: boolean;
}

export function setupLongTaskObserver(config: LongTasksConfig): void {
  if (globalThis.window === undefined || !window.PerformanceObserver) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emitEvent(WEB_EVENT.JANK, {
          // The window this jank is reported for is the long task itself.
          [APP.JANK_PERIOD]: entry.duration / 1000,
          [APP.JANK_THRESHOLD]: LONG_TASK_THRESHOLD_SECONDS,
          // `app.jank.frame_count` is deliberately absent: the browser's
          // long-task entry does not report frames, and a number we cannot
          // observe is worse than one we do not claim.
        });
        if (config.debug) {
          console.debug('[autotel-web] app.jank:', entry.duration, 'ms');
        }
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask is unsupported in some browsers; its absence is not an error.
    if (config.debug) {
      console.debug('[autotel-web] longtask observer not supported');
    }
  }
}

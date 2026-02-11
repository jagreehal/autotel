/**
 * Long-task capture for full mode (opt-in)
 *
 * Uses PerformanceObserver for "longtask" entries (main thread blocking >= 50ms).
 * Creates a span per long task for correlation with trace context.
 */

import { trace } from '@opentelemetry/api';

export interface LongTasksConfig {
  debug: boolean;
}

export function setupLongTaskObserver(config: LongTasksConfig): void {
  if (typeof window === 'undefined' || !window.PerformanceObserver) return;

  try {
    const tracer = trace.getTracer('autotel-web', '1.0.0');
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        const duration = entry.duration;
        const startTime = entry.startTime;
        tracer.startActiveSpan('long_task', (span) => {
          span.setAttribute('long_task.duration_ms', Math.round(duration));
          span.setAttribute('long_task.start_time', startTime);
          span.end();
          if (config.debug) {
            console.debug('[autotel-web] long_task:', duration, 'ms');
          }
        });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask may not be supported in all browsers
    if (config.debug) {
      console.debug('[autotel-web] longtask observer not supported');
    }
  }
}

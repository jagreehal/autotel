import { SECURITY_METRICS } from 'autotel/security-schema';
import { lazyCounter } from './lazy-counter';

/**
 * Security-telemetry heartbeat.
 *
 * A silently-dead telemetry pipeline is itself a security failure (NIST
 * SP 800-92: systems must not keep operating without visibility into
 * security events). `startSecurityHeartbeat()` emits the
 * `autotel.security.heartbeat` counter on a fixed interval so security
 * teams can alert on the ABSENCE of telemetry from a service:
 *
 * ```promql
 * absent(rate(autotel_security_heartbeat_total{service_name="api"}[5m]))
 * ```
 *
 * ```typescript
 * const heartbeat = startSecurityHeartbeat();
 * // on shutdown:
 * heartbeat.stop();
 * ```
 */

export interface SecurityHeartbeatOptions {
  /** Beat interval in milliseconds. Default 60_000. */
  intervalMs?: number;
  /** Extra counter attributes (keep cardinality low — labels, not data). */
  attributes?: Record<string, string | number | boolean>;
}

export interface SecurityHeartbeat {
  stop(): void;
}

export function startSecurityHeartbeat(
  options: SecurityHeartbeatOptions = {},
): SecurityHeartbeat {
  const intervalMs = options.intervalMs ?? 60_000;
  const attributes = options.attributes ?? {};

  const counter = lazyCounter(
    SECURITY_METRICS.heartbeat,
    'Security-telemetry liveness signal — alert on its absence',
  );

  function beat(): void {
    counter.add(1, attributes);
  }

  beat(); // establish the series immediately, not one interval later
  const timer = setInterval(beat, intervalMs);
  // Never hold the process open just to beat.
  timer.unref?.();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

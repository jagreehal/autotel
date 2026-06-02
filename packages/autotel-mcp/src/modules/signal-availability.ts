import type { TelemetryBackend } from '../backends/telemetry';
import type { BackendCapabilities } from '../types';

export interface RuntimeSignalStatus {
  enabled: boolean;
  hasData: boolean;
  detail?: string;
}

export interface RuntimeSignalAvailability {
  traces: RuntimeSignalStatus;
  metrics: RuntimeSignalStatus;
  logs: RuntimeSignalStatus;
}

function unsupported(detail: string): RuntimeSignalStatus {
  return { enabled: false, hasData: false, detail };
}

function available(hasData: boolean, detail?: string): RuntimeSignalStatus {
  return { enabled: true, hasData, detail };
}

/**
 * The probe could not run to completion — e.g. an HTTP-backed source (Jaeger,
 * Tempo, autotel-devtools) was momentarily unreachable or still starting up
 * when the MCP server connected. The backend's capabilities still *declare*
 * the signal supported, so we keep its tools enabled and let live queries
 * retry on demand. Disabling a whole signal for the entire session over a
 * transient startup blip is the worse failure mode (tools silently vanish and
 * never come back, even after the backend recovers).
 */
function unconfirmed(detail: string): RuntimeSignalStatus {
  return { enabled: true, hasData: false, detail };
}

/** Minimal shape every backend search/list result shares, as the probe reads it. */
interface ProbeQueryResult {
  unsupported?: boolean;
  detail?: string;
  totalCount?: number;
}

export async function probeSignalAvailability(
  backend: TelemetryBackend,
): Promise<RuntimeSignalAvailability> {
  const caps = backend.capabilities();

  const [traces, metrics, logs] = await Promise.all([
    probeSignal('traces', 'Trace', caps, () => backend.searchTraces({ limit: 1 })),
    probeSignal('metrics', 'Metric', caps, () => backend.listMetrics({ limit: 1 })),
    probeSignal('logs', 'Log', caps, () => backend.searchLogs({ limit: 1 })),
  ]);

  return { traces, metrics, logs };
}

/**
 * Probe one signal: capability gate → live query → classify the outcome.
 * `signal` is the capability key; `label` is the human noun for detail messages.
 */
async function probeSignal(
  signal: keyof BackendCapabilities,
  label: string,
  caps: BackendCapabilities,
  runQuery: () => Promise<ProbeQueryResult>,
): Promise<RuntimeSignalStatus> {
  if (caps[signal] !== 'available') {
    return unsupported(`Backend marks ${signal} as unsupported.`);
  }
  try {
    const res = await runQuery();
    if (res.unsupported) {
      return unsupported(res.detail ?? `${label} queries returned unsupported.`);
    }
    return available((res.totalCount ?? 0) > 0, `${label} query succeeded.`);
  } catch (error) {
    return unconfirmed(
      `${label} query probe could not reach the backend (capabilities declare ${signal} supported; tools stay enabled and retry on demand): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

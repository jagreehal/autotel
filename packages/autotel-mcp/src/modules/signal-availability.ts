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

export async function probeSignalAvailability(
  backend: TelemetryBackend,
): Promise<RuntimeSignalAvailability> {
  const caps = backend.capabilities();

  const [traces, metrics, logs] = await Promise.all([
    probeTraces(backend, caps),
    probeMetrics(backend, caps),
    probeLogs(backend, caps),
  ]);

  return { traces, metrics, logs };
}

async function probeTraces(
  backend: TelemetryBackend,
  caps: BackendCapabilities,
): Promise<RuntimeSignalStatus> {
  if (caps.traces !== 'available') {
    return unsupported('Backend marks traces as unsupported.');
  }
  try {
    const res = await backend.searchTraces({ limit: 1 });
    if (res.unsupported) {
      return unsupported(res.detail ?? 'Trace queries returned unsupported.');
    }
    return available((res.totalCount ?? 0) > 0, 'Trace query succeeded.');
  } catch (error) {
    return unsupported(
      `Trace query probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function probeMetrics(
  backend: TelemetryBackend,
  caps: BackendCapabilities,
): Promise<RuntimeSignalStatus> {
  if (caps.metrics !== 'available') {
    return unsupported('Backend marks metrics as unsupported.');
  }
  try {
    const res = await backend.listMetrics({ limit: 1 });
    if (res.unsupported) {
      return unsupported(res.detail ?? 'Metric queries returned unsupported.');
    }
    return available((res.totalCount ?? 0) > 0, 'Metric query succeeded.');
  } catch (error) {
    return unsupported(
      `Metric query probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function probeLogs(
  backend: TelemetryBackend,
  caps: BackendCapabilities,
): Promise<RuntimeSignalStatus> {
  if (caps.logs !== 'available') {
    return unsupported('Backend marks logs as unsupported.');
  }
  try {
    const res = await backend.searchLogs({ limit: 1 });
    if (res.unsupported) {
      return unsupported(res.detail ?? 'Log queries returned unsupported.');
    }
    return available((res.totalCount ?? 0) > 0, 'Log query succeeded.');
  } catch (error) {
    return unsupported(
      `Log query probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

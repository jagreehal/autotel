/**
 * Backend auto-detection: probe well-known URLs and report which backends
 * respond. Used when AUTOTEL_BACKEND=auto to avoid forcing users to set a
 * specific backend name. Never throws — probes that fail are simply
 * reported as unavailable.
 */
export type ProbeKind = 'tempo' | 'jaeger' | 'prometheus' | 'loki';

export interface ProbeResult {
  kind: ProbeKind;
  url: string;
  reachable: boolean;
}

interface Probe {
  kind: ProbeKind;
  path: string;
}

const PROBES: Record<ProbeKind, Probe> = {
  tempo: { kind: 'tempo', path: '/api/echo' },
  jaeger: { kind: 'jaeger', path: '/api/services' },
  prometheus: { kind: 'prometheus', path: '/api/v1/status/buildinfo' },
  loki: { kind: 'loki', path: '/ready' },
};

const PROBE_TIMEOUT_MS = 1500;

export async function probeBackend(
  kind: ProbeKind,
  url: string,
): Promise<ProbeResult> {
  const probe = PROBES[kind];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${probe.path}`, {
      signal: controller.signal,
    });
    return { kind, url, reachable: res.ok };
  } catch {
    return { kind, url, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAll(
  candidates: Partial<Record<ProbeKind, string>>,
): Promise<ProbeResult[]> {
  const entries = Object.entries(candidates) as [ProbeKind, string][];
  return Promise.all(entries.map(([kind, url]) => probeBackend(kind, url)));
}

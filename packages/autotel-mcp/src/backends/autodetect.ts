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
  /** Any of these answering means the backend is there. */
  paths: string[];
}

const PROBES = {
  tempo: { kind: 'tempo', paths: ['/api/echo'] },
  // Jaeger 2.22 serves /api/v3 in place of /api/services.
  jaeger: { kind: 'jaeger', paths: ['/api/services', '/api/v3/services'] },
  prometheus: { kind: 'prometheus', paths: ['/api/v1/status/buildinfo'] },
  loki: { kind: 'loki', paths: ['/ready'] },
} satisfies Record<ProbeKind, Probe>;

const PROBE_TIMEOUT_MS = 1500;

export async function probeBackend(
  kind: ProbeKind,
  url: string,
): Promise<ProbeResult> {
  const probe = PROBES[kind];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    for (const path of probe.paths) {
      const res = await fetch(`${url}${path}`, { signal: controller.signal });
      if (res.ok) return { kind, url, reachable: true };
    }
    return { kind, url, reachable: false };
  } catch {
    return { kind, url, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAll(
  candidates: Partial<Record<ProbeKind, string>>,
): Promise<ProbeResult[]> {
  // SAFETY: Object.entries widens the key to string. `candidates` is keyed by
  // ProbeKind, and undefined values are filtered before the assertion is used.
  const entries = Object.entries(candidates).filter(
    ([, url]) => url !== undefined,
  ) as [ProbeKind, string][];
  return Promise.all(entries.map(([kind, url]) => probeBackend(kind, url)));
}

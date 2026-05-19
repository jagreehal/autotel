import type { AppConfig } from '../config';
import type { TelemetryBackend } from './telemetry';
import { CollectorBackend } from './collector/index';
import { JaegerBackend } from './jaeger/index';
import { TempoBackend } from './tempo/index';
import { PrometheusBackend } from './prometheus/index';
import { LokiBackend } from './loki/index';
import { FixtureBackend } from './fixture/index';
import {
  CompositeBackend,
  type CompositeBackendParts,
} from './composite/index';
import { probeAll, type ProbeResult } from './autodetect';

export interface BackendHandle {
  backend: TelemetryBackend;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function createBackend(config: AppConfig): Promise<BackendHandle> {
  let backend: TelemetryBackend;
  let start: () => Promise<void> = async () => {};
  let stop: () => Promise<void> = async () => {};

  switch (config.backend) {
    case 'collector': {
      const collector = new CollectorBackend({
        port: config.collectorPort,
        maxTraces: config.maxTraces,
        retentionMs: config.retentionMs!,
        persist: config.persist,
      });
      backend = collector;
      start = () => collector.start();
      stop = () => collector.stop();
      break;
    }
    case 'jaeger': {
      backend = new JaegerBackend(config.jaegerBaseUrl);
      break;
    }
    case 'tempo': {
      backend = new TempoBackend(config.tempoBaseUrl);
      break;
    }
    case 'prometheus': {
      backend = new PrometheusBackend(config.prometheusBaseUrl);
      break;
    }
    case 'loki': {
      backend = new LokiBackend(config.lokiBaseUrl);
      break;
    }
    case 'stack': {
      backend = buildStackBackend(config);
      break;
    }
    case 'auto': {
      backend = await buildAutoBackend(config);
      break;
    }
    case 'fixture':
    default: {
      backend = new FixtureBackend(config.fixturePath);
      break;
    }
  }

  return { backend, start, stop };
}

function buildStackBackend(config: AppConfig): TelemetryBackend {
  const parts: CompositeBackendParts = {};
  if (process.env.TEMPO_BASE_URL) {
    parts.traces = new TempoBackend(config.tempoBaseUrl);
  } else if (process.env.JAEGER_BASE_URL) {
    parts.traces = new JaegerBackend(config.jaegerBaseUrl);
  }
  if (process.env.PROMETHEUS_BASE_URL) {
    parts.metrics = new PrometheusBackend(config.prometheusBaseUrl);
  }
  if (process.env.LOKI_BASE_URL) {
    parts.logs = new LokiBackend(config.lokiBaseUrl);
  }
  if (!parts.traces && !parts.metrics && !parts.logs) {
    throw new Error(
      'AUTOTEL_BACKEND=stack requires at least one of TEMPO_BASE_URL, JAEGER_BASE_URL, PROMETHEUS_BASE_URL, LOKI_BASE_URL.',
    );
  }
  return new CompositeBackend(parts);
}

async function buildAutoBackend(config: AppConfig): Promise<TelemetryBackend> {
  const probes = await probeAll({
    tempo: config.tempoBaseUrl,
    jaeger: config.jaegerBaseUrl,
    prometheus: config.prometheusBaseUrl,
    loki: config.lokiBaseUrl,
  });
  const reachable = probes.filter((p) => p.reachable);
  if (reachable.length === 0) {
    console.error(
      '[autotel-mcp] auto-detect found nothing reachable — falling back to fixture backend.',
    );
    return new FixtureBackend(config.fixturePath);
  }

  const parts: CompositeBackendParts = {};
  const tracesProbe = pickTracesProbe(reachable);
  if (tracesProbe?.kind === 'tempo') {
    parts.traces = new TempoBackend(tracesProbe.url);
  } else if (tracesProbe?.kind === 'jaeger') {
    parts.traces = new JaegerBackend(tracesProbe.url);
  }
  const promProbe = reachable.find((p) => p.kind === 'prometheus');
  if (promProbe) parts.metrics = new PrometheusBackend(promProbe.url);
  const lokiProbe = reachable.find((p) => p.kind === 'loki');
  if (lokiProbe) parts.logs = new LokiBackend(lokiProbe.url);

  console.error(
    `[autotel-mcp] auto-detected: ${reachable.map((p) => p.kind).join(', ')}`,
  );
  return new CompositeBackend(parts);
}

function pickTracesProbe(probes: ProbeResult[]): ProbeResult | undefined {
  return (
    probes.find((p) => p.kind === 'tempo') ??
    probes.find((p) => p.kind === 'jaeger')
  );
}

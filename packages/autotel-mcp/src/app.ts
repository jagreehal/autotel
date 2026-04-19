import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type AppConfig } from './config';
import type { TelemetryBackend } from './backends/telemetry';
import { CollectorBackend } from './backends/collector/index';
import { JaegerBackend } from './backends/jaeger/index';
import { TempoBackend } from './backends/tempo/index';
import { PrometheusBackend } from './backends/prometheus/index';
import { LokiBackend } from './backends/loki/index';
import { FixtureBackend } from './backends/fixture/index';
import {
  CompositeBackend,
  type CompositeBackendParts,
} from './backends/composite/index';
import { probeAll, type ProbeResult } from './backends/autodetect';
import { registerTools } from './tools/index';
import { probeSignalAvailability } from './modules/signal-availability';
import { VERSION } from './version';

export interface App {
  config: AppConfig;
  server: McpServer;
  backend: TelemetryBackend;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createApp(): Promise<App> {
  const config = loadConfig();

  let backend: TelemetryBackend;
  let startBackend: () => Promise<void> = async () => {};
  let stopBackend: () => Promise<void> = async () => {};

  switch (config.backend) {
    case 'collector': {
      const collector = new CollectorBackend({
        port: config.collectorPort,
        maxTraces: config.maxTraces,
        retentionMs: config.retentionMs!,
        persist: config.persist,
      });
      backend = collector;
      startBackend = () => collector.start();
      stopBackend = () => collector.stop();
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

  const server = new McpServer({
    name: 'autotel-mcp',
    version: VERSION,
  });

  let toolsRegistered = false;

  return {
    config,
    server,
    backend,
    start: async () => {
      await startBackend();
      if (!toolsRegistered) {
        let availability;
        try {
          availability = await probeSignalAvailability(backend);
        } catch (error) {
          console.error(
            '[autotel-mcp] runtime signal probe failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
        registerTools(server, backend, availability);
        toolsRegistered = true;
      }
    },
    stop: stopBackend,
  };
}

function buildStackBackend(config: AppConfig): TelemetryBackend {
  const parts: CompositeBackendParts = {};
  // Only wire each signal if its URL is explicitly set (i.e. not the default
  // "localhost" assumption). This lets `AUTOTEL_BACKEND=stack` scale up or
  // down gracefully based on which env vars the user provides.
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

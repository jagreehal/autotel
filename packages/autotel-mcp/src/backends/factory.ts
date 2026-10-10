import type { AppConfig } from '../config';
import type { TelemetryBackend } from './telemetry';
import { CollectorBackend } from './collector/index';
import { JaegerBackend } from './jaeger/index';
import { DevtoolsBackend } from './devtools/index';
import { TempoBackend } from './tempo/index';
import { PrometheusBackend } from './prometheus/index';
import { LokiBackend } from './loki/index';
import { FixtureBackend } from './fixture/index';
import { LogfireBackend } from './logfire/index';
import { DatadogBackend } from './datadog/index';
import { SignozBackend } from './signoz/index';
import { CloudflareBackend } from './cloudflare/index';
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
        // The receiver binds to loopback, so frames from this machine's
        // builds map through the maps beside them; production maps go in
        // AUTOTEL_SOURCEMAPS, matched by bundle file name.
        sourceMaps: {
          roots: [process.cwd()],
          ...(process.env.AUTOTEL_SOURCEMAPS
            ? { mapsDir: process.env.AUTOTEL_SOURCEMAPS }
            : {}),
        },
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
    case 'devtools': {
      backend = new DevtoolsBackend(config.devtoolsBaseUrl);
      break;
    }
    case 'tempo': {
      backend = new TempoBackend(
        config.tempoBaseUrl,
        grafanaAuth(config, config.tempoUsername),
        grafanaLinks(config),
      );
      break;
    }
    case 'prometheus': {
      backend = new PrometheusBackend(
        config.prometheusBaseUrl,
        grafanaAuth(config, config.prometheusUsername),
      );
      break;
    }
    case 'loki': {
      backend = new LokiBackend(
        config.lokiBaseUrl,
        grafanaAuth(config, config.lokiUsername),
      );
      break;
    }
    case 'logfire': {
      backend = new LogfireBackend({
        baseUrl: config.logfireBaseUrl,
        readToken: config.logfireReadToken,
      });
      break;
    }
    case 'datadog': {
      backend = new DatadogBackend({
        baseUrl: config.datadogSite,
        apiKey: config.datadogApiKey,
        appKey: config.datadogAppKey,
      });
      break;
    }
    case 'signoz': {
      backend = new SignozBackend({
        baseUrl: config.signozBaseUrl,
        apiKey: config.signozApiKey,
      });
      break;
    }
    case 'cloudflare': {
      backend = new CloudflareBackend({
        accountId: config.cloudflareAccountId,
        apiToken: config.cloudflareApiToken,
      });
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

/**
 * Grafana Cloud reads with basic auth: the signal's user id (Tempo, Loki and
 * Prometheus each have their own) and one read-scoped access policy token.
 * A token with no user id is sent as a bearer token, for a self-hosted stack
 * behind an auth proxy.
 */
export function grafanaAuth(
  config: Pick<AppConfig, 'grafanaCloudToken'>,
  username: string,
): Record<string, string> {
  const token = config.grafanaCloudToken;
  if (!token) return {};
  if (!username) return { Authorization: `Bearer ${token}` };
  const encoded = Buffer.from(`${username}:${token}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function grafanaLinks(
  config: Pick<AppConfig, 'grafanaUrl' | 'grafanaTempoDatasource'>,
): { url: string; datasourceUid: string } | undefined {
  return config.grafanaUrl
    ? { url: config.grafanaUrl, datasourceUid: config.grafanaTempoDatasource }
    : undefined;
}

function buildStackBackend(config: AppConfig): TelemetryBackend {
  const parts: CompositeBackendParts = {};
  if (process.env.TEMPO_BASE_URL) {
    parts.traces = new TempoBackend(
      config.tempoBaseUrl,
      grafanaAuth(config, config.tempoUsername),
      grafanaLinks(config),
    );
  } else if (process.env.JAEGER_BASE_URL) {
    parts.traces = new JaegerBackend(config.jaegerBaseUrl);
  }
  if (process.env.PROMETHEUS_BASE_URL) {
    parts.metrics = new PrometheusBackend(
      config.prometheusBaseUrl,
      grafanaAuth(config, config.prometheusUsername),
    );
  }
  if (process.env.LOKI_BASE_URL) {
    parts.logs = new LokiBackend(
      config.lokiBaseUrl,
      grafanaAuth(config, config.lokiUsername),
    );
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

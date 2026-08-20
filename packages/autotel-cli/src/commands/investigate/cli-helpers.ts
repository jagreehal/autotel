import { Command } from 'commander';
import type { InvestigateFlags } from './runtime';
import { numberOpt, stringOpt } from '../../lib/opts.js';

/**
 * Shared commander wiring for investigate commands. Each command group's
 * file imports these and exports a `register*(program)` function that
 * does its own commander setup. cli.ts then just calls the registrars.
 */

export const intArg = (v: string): number => Number.parseInt(v, 10);
export const floatArg = (v: string): number => Number.parseFloat(v);

/**
 * Backend-selection + JSON-output flags shared by every backend-touching
 * investigate command. Applied to a Command in place (mutates + returns).
 */
export function addBackendFlags(cmd: Command): Command {
  return (
    cmd
      .option(
        '--backend <kind>',
        'Backend: collector|jaeger|tempo|prometheus|loki|stack|auto|fixture|logfire|datadog|signoz (env: AUTOTEL_BACKEND)',
      )
      .option(
        '--jaeger-base-url <url>',
        'Jaeger base URL (env: JAEGER_BASE_URL)',
      )
      .option('--tempo-base-url <url>', 'Tempo base URL (env: TEMPO_BASE_URL)')
      .option(
        '--prometheus-base-url <url>',
        'Prometheus base URL (env: PROMETHEUS_BASE_URL)',
      )
      .option('--loki-base-url <url>', 'Loki base URL (env: LOKI_BASE_URL)')
      .option(
        '--collector-port <n>',
        'OTLP receiver port for the collector backend',
        intArg,
      )
      .option('--fixture-path <path>', 'Fixture JSON for the fixture backend')
      // Hosted vendor backends take a base URL by flag but their credentials by
      // environment only — argv is readable from the process table.
      .option(
        '--logfire-base-url <url>',
        'Logfire region URL (env: LOGFIRE_BASE_URL; token via LOGFIRE_READ_TOKEN)',
      )
      .option(
        '--datadog-site <site>',
        'Datadog site, e.g. datadoghq.eu, or a full API URL (env: DD_SITE; keys via DD_API_KEY + DD_APP_KEY)',
      )
      .option(
        '--signoz-base-url <url>',
        'SigNoz base URL (env: SIGNOZ_BASE_URL; key via SIGNOZ_API_KEY)',
      )
      .option('--output-file <path>', 'Persist JSON output to this file')
      .option('--no-secrets-in-output', 'Redact secret-shaped values')
  );
}

/**
 * Smaller flag set for commands that don't need a backend (semconv,
 * instrumentation scoring, collector schema lookups).
 */
export function addStaticFlags(cmd: Command): Command {
  return cmd
    .option('--output-file <path>', 'Persist JSON output to this file')
    .option('--no-secrets-in-output', 'Redact secret-shaped values');
}

export function backendFlagsFromOpts(
  opts: Record<string, unknown>,
): InvestigateFlags {
  return {
    backend: opts.backend as InvestigateFlags['backend'],
    jaegerBaseUrl: stringOpt(opts, 'jaegerBaseUrl'),
    tempoBaseUrl: stringOpt(opts, 'tempoBaseUrl'),
    prometheusBaseUrl: stringOpt(opts, 'prometheusBaseUrl'),
    lokiBaseUrl: stringOpt(opts, 'lokiBaseUrl'),
    collectorPort: numberOpt(opts, 'collectorPort'),
    fixturePath: stringOpt(opts, 'fixturePath'),
    logfireBaseUrl: stringOpt(opts, 'logfireBaseUrl'),
    datadogSite: stringOpt(opts, 'datadogSite'),
    signozBaseUrl: stringOpt(opts, 'signozBaseUrl'),
    outputFile: stringOpt(opts, 'outputFile'),
    noSecrets: opts.secretsInOutput === false,
  };
}

export function staticFlagsFromOpts(
  opts: Record<string, unknown>,
): InvestigateFlags {
  return {
    outputFile: stringOpt(opts, 'outputFile'),
    noSecrets: opts.secretsInOutput === false,
  };
}

/**
 * Common time-window flags for trace/span/metric/log queries.
 */
export function addTimeWindowFlags(cmd: Command): Command {
  return cmd
    .option('--service-name <name>', 'Filter by service name')
    .option('--operation-name <name>', 'Filter by operation name')
    .option('--lookback-minutes <n>', 'Lookback window in minutes', intArg)
    .option('--from <iso>', 'Start time (ISO 8601)')
    .option('--to <iso>', 'End time (ISO 8601)')
    .option('--limit <n>', 'Max results', intArg);
}

/** Values collected by `addTimeWindowFlags`. */
export type TimeWindowFlags = {
  serviceName?: string;
  operationName?: string;
  lookbackMinutes?: number;
  from?: string;
  to?: string;
  limit?: number;
};

export function windowFlagsFromOpts(
  opts: Record<string, unknown>,
): TimeWindowFlags {
  return {
    serviceName: stringOpt(opts, 'serviceName'),
    operationName: stringOpt(opts, 'operationName'),
    lookbackMinutes: numberOpt(opts, 'lookbackMinutes'),
    from: stringOpt(opts, 'from'),
    to: stringOpt(opts, 'to'),
    limit: numberOpt(opts, 'limit'),
  };
}

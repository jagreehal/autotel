import { Command } from 'commander';
import type { InvestigateFlags } from './runtime';

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
  return cmd
    .option(
      '--backend <kind>',
      'Backend: collector|jaeger|tempo|prometheus|loki|stack|auto|fixture (env: AUTOTEL_BACKEND)',
    )
    .option('--jaeger-base-url <url>', 'Jaeger base URL (env: JAEGER_BASE_URL)')
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
    .option('--output-file <path>', 'Persist JSON output to this file')
    .option('--no-secrets-in-output', 'Redact secret-shaped values');
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

export function backendFlagsFromOpts(opts: Record<string, unknown>): InvestigateFlags {
  return {
    backend: opts.backend as InvestigateFlags['backend'],
    jaegerBaseUrl: opts.jaegerBaseUrl as string | undefined,
    tempoBaseUrl: opts.tempoBaseUrl as string | undefined,
    prometheusBaseUrl: opts.prometheusBaseUrl as string | undefined,
    lokiBaseUrl: opts.lokiBaseUrl as string | undefined,
    collectorPort: opts.collectorPort as number | undefined,
    fixturePath: opts.fixturePath as string | undefined,
    outputFile: opts.outputFile as string | undefined,
    noSecrets: opts.secretsInOutput === false,
  };
}

export function staticFlagsFromOpts(opts: Record<string, unknown>): InvestigateFlags {
  return {
    outputFile: opts.outputFile as string | undefined,
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

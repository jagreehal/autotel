import { Command } from 'commander';
import type { InvestigateFlags } from './runtime';
import { runInvestigate } from './runtime';
import { addBackendFlags, backendFlagsFromOpts } from './cli-helpers';
import type { OtlpEncoding } from './freshness';
import { measureFreshness } from './freshness';
import { numberOpt, stringOpt } from '../../lib/opts.js';

export interface HealthFlags extends InvestigateFlags {
  /** Also measure ingest-to-queryable lag by writing a probe span here. */
  otlpEndpoint?: string;
  freshnessTimeoutMs?: number;
  otlpEncoding?: OtlpEncoding;
}

export function resolvedFreshnessEncoding(
  requested: OtlpEncoding | undefined,
  backend: Pick<{ kind: string }, 'kind'>,
): OtlpEncoding {
  return requested ?? (backend.kind === 'collector' ? 'json' : 'protobuf');
}

export async function runHealth(flags: HealthFlags): Promise<void> {
  await runInvestigate('health', flags, async (backend) => {
    const [health, capabilities] = await Promise.all([
      backend.healthCheck(),
      Promise.resolve(backend.capabilities()),
    ]);
    const base = { ...health, signals: capabilities };
    if (!flags.otlpEndpoint) return base;

    // Protobuf is what OTLP/HTTP receivers must accept and what several hosted
    // vendors accept exclusively — but our own in-process collector parses JSON
    // only, so it gets JSON unless the caller says otherwise.
    const encoding = resolvedFreshnessEncoding(flags.otlpEncoding, backend);

    const freshness = await measureFreshness({
      backend,
      otlpEndpoint: flags.otlpEndpoint,
      timeoutMs: flags.freshnessTimeoutMs,
      encoding,
    });
    return { ...base, freshness };
  });
}

export async function runCapabilities(flags: InvestigateFlags): Promise<void> {
  await runInvestigate('capabilities', flags, async (backend) =>
    backend.capabilities(),
  );
}

export function registerHealthCommands(program: Command): void {
  const healthCmd = new Command('health')
    .description('Backend health check + signal coverage (JSON)')
    .option(
      '--otlp-endpoint <url>',
      'Also measure ingest-to-queryable lag: write a probe span to this OTLP/HTTP endpoint and poll until it reads back',
    )
    .option(
      '--freshness-timeout-ms <ms>',
      'Give up waiting for the probe span after this long (default 120000)',
      (value: string) => Number.parseInt(value, 10),
    )
    .option(
      '--otlp-encoding <encoding>',
      'Probe payload encoding: protobuf (default, and the only one some vendors accept) or json (the built-in collector)',
    )
    .action(async function (this: Command) {
      const opts = this.opts();
      await runHealth({
        ...backendFlagsFromOpts(opts),
        otlpEndpoint: stringOpt(opts, 'otlpEndpoint'),
        freshnessTimeoutMs: numberOpt(opts, 'freshnessTimeoutMs'),
        otlpEncoding: opts.otlpEncoding as OtlpEncoding | undefined,
      });
    });
  addBackendFlags(healthCmd);
  program.addCommand(healthCmd);

  const capabilitiesCmd = new Command('capabilities')
    .description('Which telemetry signals the active backend can serve (JSON)')
    .action(async function (this: Command) {
      await runCapabilities(backendFlagsFromOpts(this.opts()));
    });
  addBackendFlags(capabilitiesCmd);
  program.addCommand(capabilitiesCmd);
}

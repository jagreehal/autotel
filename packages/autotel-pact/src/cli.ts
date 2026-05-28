#!/usr/bin/env node
import { runAudit } from './audit.js';
import { brokerConfigFromEnv } from './broker.js';
import { CLI_COLUMNS, formatYesNo } from './labels.js';
import type { AuditMatrix, AuditRow } from './types.js';

interface CliArgs {
  pactsDir?: string;
  ledgerDir?: string;
  windowDays?: number;
  gate: 'off' | 'on' | 'strict' | 'broker';
  json: boolean;
  help: boolean;
  brokerUrl?: string;
  brokerToken?: string;
}

const HELP_TEXT = `autotel-pact audit — runtime evidence for Pact contracts

USAGE
  autotel-pact audit [options]

OPTIONS
  --pacts <dir>         Directory containing pact files (default: ./pacts)
  --ledger <dir>        Directory containing ledger files (default: .autotel-pact)
  --window <days>       How many days back to consider observations recent (default: 14)
  --gate                Exit non-zero if any contracted interaction was not seen in test
  --gate=strict         Also exit non-zero on observations with no matching contract
  --gate=broker         Exit non-zero if broker is configured and any row lacks broker verification
  --broker-url <url>    Pact Broker base URL (or PACT_BROKER_BASE_URL)
  --broker-token <tok>  Pact Broker bearer token (or PACT_BROKER_TOKEN)
  --json                Emit machine-readable JSON instead of a table
  --help, -h            Show this help

ENVIRONMENT
  AUTOTEL_PACT_RUN_ID         Tag ledger entries with a run id
  AUTOTEL_PACT_LEDGER_DIR     Override default ledger directory
  PACT_BROKER_BASE_URL        Broker base URL
  PACT_BROKER_TOKEN           Broker bearer token
  PACT_BROKER_USERNAME        Broker basic auth username
  PACT_BROKER_PASSWORD        Broker basic auth password
`;

function parseDuration(value: string): number {
  const m = /^(\d+)(d?)$/.exec(value);
  if (!m) throw new Error(`Invalid --window value: ${value}`);
  return Number.parseInt(m[1]!, 10);
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { gate: 'off', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
    case '--help':
    case '-h': {
      args.help = true;
      break;
    }
    case '--json': {
      args.json = true;
      break;
    }
    case '--gate': {
      args.gate = 'on';
      break;
    }
    case '--gate=strict': {
      args.gate = 'strict';
      break;
    }
    case '--gate=broker': {
      args.gate = 'broker';
      break;
    }
    case '--pacts': {
      args.pactsDir = requireValue(argv, ++i, '--pacts');
      break;
    }
    case '--ledger': {
      args.ledgerDir = requireValue(argv, ++i, '--ledger');
      break;
    }
    case '--window': {
      args.windowDays = parseDuration(requireValue(argv, ++i, '--window'));
      break;
    }
    case '--broker-url': {
      args.brokerUrl = requireValue(argv, ++i, '--broker-url');
      break;
    }
    case '--broker-token': {
      args.brokerToken = requireValue(argv, ++i, '--broker-token');
      break;
    }
    default: {
      if (a.startsWith('--pacts=')) {
        const value = a.slice('--pacts='.length);
        if (!value) throw new Error('Missing value for --pacts');
        args.pactsDir = value;
      } else if (a.startsWith('--ledger=')) {
        const value = a.slice('--ledger='.length);
        if (!value) throw new Error('Missing value for --ledger');
        args.ledgerDir = value;
      } else if (a.startsWith('--window=')) {
        const value = a.slice('--window='.length);
        if (!value) throw new Error('Missing value for --window');
        args.windowDays = parseDuration(value);
      } else if (a.startsWith('--broker-url=')) {
        const value = a.slice('--broker-url='.length);
        if (!value) throw new Error('Missing value for --broker-url');
        args.brokerUrl = value;
      } else if (a.startsWith('--broker-token=')) {
        const value = a.slice('--broker-token='.length);
        if (!value) throw new Error('Missing value for --broker-token');
        args.brokerToken = value;
      } else if (a === 'audit') continue;
      else throw new Error(`Unknown argument: ${a}`);
    }
    }
  }
  return args;
}

function statusLabel(r: AuditRow): string {
  if (r.contracted && r.test_seen) return 'OK';
  if (r.contracted && !r.test_seen) return 'STALE';
  return 'SHADOW';
}

function formatTable(matrix: AuditMatrix): string {
  const lines: string[] = [
    `Window: last ${matrix.window_days} day(s)`,
    `Generated: ${matrix.generated_at}`,
    '',
  ];

  if (matrix.rows.length === 0) {
    lines.push('No contracts or observations found.');
    return lines.join('\n');
  }

  const header = [
    CLI_COLUMNS.STATUS,
    CLI_COLUMNS.CONTRACTED,
    CLI_COLUMNS.TEST_SEEN,
    CLI_COLUMNS.PROD_SEEN,
    CLI_COLUMNS.PROVIDER_VERIFIED,
    CLI_COLUMNS.BROKER_VERIFIED,
    CLI_COLUMNS.PAIR,
    CLI_COLUMNS.KIND,
    CLI_COLUMNS.INTERACTION,
  ];
  const rows = matrix.rows.map((r) => [
    statusLabel(r),
    formatYesNo(r.contracted),
    formatYesNo(r.test_seen),
    formatYesNo(r.prod_seen),
    formatYesNo(r.provider_verified),
    formatYesNo(r.broker_verified),
    `${r.consumer} → ${r.provider}`,
    r.kind,
    r.interaction,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]!.length)),
  );
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');

  lines.push(
    fmt(header),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map((r) => fmt(r)),
    '',
    'Summary',
    `  Total interactions:               ${matrix.counts.total}`,
    `  Contracted:                       ${matrix.counts.contracted}`,
    `  Seen in test:                     ${matrix.counts.test_seen}`,
    `  Seen in production:               ${matrix.counts.prod_seen}`,
    `  Provider verified (interaction):  ${matrix.counts.provider_verified}`,
    `  Broker verified (pact-pair):      ${matrix.counts.broker_verified}`,
    `  Contracted AND seen in test:      ${matrix.counts.contracted_and_test_seen}`,
    `  Contracted, NOT seen in test:     ${matrix.counts.contracted_not_test_seen}  ← stale confidence`,
    `  Seen, NOT contracted:             ${matrix.counts.test_or_prod_seen_not_contracted}  ← ungoverned flow`,
  );

  if (matrix.verification_failures && matrix.verification_failures.length > 0) {
    lines.push('', 'Provider verification failures (run-level):');
    for (const f of matrix.verification_failures) {
      lines.push(`  ${f.consumer} → ${f.provider}: ${f.error}`);
    }
  }

  const brokerErrors = new Map<string, string>();
  for (const r of matrix.rows) {
    if (r.broker_error) {
      brokerErrors.set(`${r.consumer} → ${r.provider}`, r.broker_error);
    }
  }
  if (brokerErrors.size > 0) {
    lines.push('', 'Broker unreachable / errored (verification status unknown):');
    for (const [pair, err] of brokerErrors) {
      lines.push(`  ${pair}: ${err}`);
    }
  }

  return lines.join('\n');
}

function shouldFail(matrix: AuditMatrix, gate: CliArgs['gate']): boolean {
  if (gate === 'off') return false;
  if (matrix.counts.contracted_not_test_seen > 0) return true;
  if (gate === 'strict' && matrix.counts.test_or_prod_seen_not_contracted > 0) return true;
  if (gate === 'broker') {
    const contractedRows = matrix.rows.filter((r) => r.contracted);
    // Fail loudly on unreachable broker — a transient outage should not be
    // silently treated as "not verified" because that would mask broker health
    // problems behind a contract-verification message.
    if (contractedRows.some((r) => r.broker_error)) return true;
    if (contractedRows.some((r) => !r.broker_verified)) return true;
  }
  return false;
}

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP_TEXT}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const envBroker = brokerConfigFromEnv();
  const broker =
    args.brokerUrl || envBroker
      ? {
          baseUrl: args.brokerUrl ?? envBroker!.baseUrl,
          token: args.brokerToken ?? envBroker?.token,
          username: envBroker?.username,
          password: envBroker?.password,
        }
      : undefined;

  const matrix = await runAudit({
    pactsDir: args.pactsDir,
    dir: args.ledgerDir,
    windowDays: args.windowDays,
    broker,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(matrix, null, 2) + '\n');
  } else {
    process.stdout.write(formatTable(matrix) + '\n');
  }

  return shouldFail(matrix, args.gate) ? 1 : 0;
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('autotel-pact'));

if (isDirectInvocation) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadSnapshot } from './snapshot';
import { readCatalogState } from './catalog';
import { diffCatalogAgainstSnapshot, countDriftReport } from './diff';
import { compareDriftReports, countDriftEntries } from './diff-vs-base';
import { getRenderer, RENDERER_NAMES } from './renderers/index';
import { evaluatePolicy, type DriftPolicyMode } from './policy';
import { stampCatalog, buildStampSummary } from './stamp';
import { generateCatalogFromSnapshot, buildGenerateSummary } from './generate';

/** Built-in renderer names. Kept as a string so the type allows future
 *  renderers (sarif, slack, ...) without churning the CLI argument type. */
type OutputFormat = string;

type DriftArgs = {
  command: 'drift';
  snapshot: string;
  baseSnapshot?: string;
  catalog: string;
  output?: string;
  summaryOutput?: string;
  failOnDrift: boolean;
  /** undefined ⇒ derived at use site: new-only when baseSnapshot present, else all. */
  policy: DriftPolicyMode | undefined;
  format: OutputFormat;
};

type StampArgs = {
  command: 'stamp';
  snapshot: string;
  catalog: string;
  dryRun: boolean;
  summaryOutput?: string;
};

type GenerateArgs = {
  command: 'generate';
  snapshot: string;
  catalog: string;
  dryRun: boolean;
  edgesOnly: boolean;
  version: string;
  summaryOutput?: string;
};

type Args = DriftArgs | StampArgs | GenerateArgs;

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (command !== 'drift' && command !== 'stamp' && command !== 'generate') {
    usage();
    process.exit(2);
  }

  if (command === 'generate') {
    return parseGenerateArgs(rest);
  }

  if (command === 'stamp') {
    return parseStampArgs(rest);
  }

  return parseDriftArgs(rest);
}

function parseDriftArgs(rest: string[]): DriftArgs {
  let snapshot: string | undefined;
  let baseSnapshot: string | undefined;
  let catalog: string | undefined;
  let output: string | undefined;
  let summaryOutput: string | undefined;
  let failOnDrift = false;
  let policy: DriftPolicyMode | undefined;
  let format: OutputFormat = 'markdown';

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    switch (arg) {
      case '--snapshot': {
        snapshot = next;
        i++;
        break;
      }
      case '--base-snapshot': {
        baseSnapshot = next;
        i++;
        break;
      }
      case '--catalog': {
        catalog = next;
        i++;
        break;
      }
      case '--output': {
        output = next;
        i++;
        break;
      }
      case '--summary-output': {
        summaryOutput = next;
        i++;
        break;
      }
      case '--fail-on-drift': {
        failOnDrift = true;
        break;
      }
      case '--policy': {
        if (next !== 'all' && next !== 'new-only') {
          process.stderr.write(
            `Invalid --policy value: ${next}. Use 'all' or 'new-only'.\n`,
          );
          process.exit(2);
        }
        policy = next;
        i++;
        break;
      }
      case '--format': {
        if (!getRenderer(next)) {
          process.stderr.write(
            `Invalid --format value: ${next}. Available renderers: ${RENDERER_NAMES.join(', ')}.\n`,
          );
          process.exit(2);
        }
        format = next;
        i++;
        break;
      }
      case '-h':
      case '--help': {
        usage();
        process.exit(0);
        break;
      }
      default: {
        process.stderr.write(`Unknown argument: ${arg}\n`);
        usage();
        process.exit(2);
      }
    }
  }

  if (!snapshot || !catalog) {
    process.stderr.write('Both --snapshot and --catalog are required.\n');
    usage();
    process.exit(2);
  }

  if (policy === 'new-only' && !baseSnapshot) {
    process.stderr.write('--policy new-only requires --base-snapshot.\n');
    process.exit(2);
  }

  // Note: the *effective* policy is derived at use site (see runDrift).
  // When the user omits --policy, the choice is "new-only when
  // --base-snapshot is present, else all" — explicit at the call site,
  // never via a silent flag rewrite here.

  return {
    command: 'drift',
    snapshot: resolve(snapshot),
    baseSnapshot: baseSnapshot ? resolve(baseSnapshot) : undefined,
    catalog: resolve(catalog),
    output: output ? resolve(output) : undefined,
    summaryOutput: summaryOutput ? resolve(summaryOutput) : undefined,
    failOnDrift,
    policy,
    format,
  };
}

function parseStampArgs(rest: string[]): StampArgs {
  let snapshot: string | undefined;
  let catalog: string | undefined;
  let dryRun = false;
  let summaryOutput: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    switch (arg) {
      case '--snapshot': {
        snapshot = next;
        i++;
        break;
      }
      case '--catalog': {
        catalog = next;
        i++;
        break;
      }
      case '--dry-run': {
        dryRun = true;
        break;
      }
      case '--summary-output': {
        summaryOutput = next;
        i++;
        break;
      }
      case '-h':
      case '--help': {
        usage();
        process.exit(0);
        break;
      }
      default: {
        process.stderr.write(`Unknown argument: ${arg}\n`);
        usage();
        process.exit(2);
      }
    }
  }

  if (!snapshot || !catalog) {
    process.stderr.write(
      'Both --snapshot and --catalog are required for stamp.\n',
    );
    usage();
    process.exit(2);
  }

  return {
    command: 'stamp',
    snapshot: resolve(snapshot),
    catalog: resolve(catalog),
    dryRun,
    summaryOutput: summaryOutput ? resolve(summaryOutput) : undefined,
  };
}

function parseGenerateArgs(rest: string[]): GenerateArgs {
  let snapshot: string | undefined;
  let catalog: string | undefined;
  let dryRun = false;
  let edgesOnly = false;
  let version = '1.0.0';
  let summaryOutput: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    switch (arg) {
      case '--snapshot': {
        snapshot = next;
        i++;
        break;
      }
      case '--catalog': {
        catalog = next;
        i++;
        break;
      }
      case '--dry-run': {
        dryRun = true;
        break;
      }
      case '--edges-only': {
        edgesOnly = true;
        break;
      }
      case '--version': {
        version = next;
        i++;
        break;
      }
      case '--summary-output': {
        summaryOutput = next;
        i++;
        break;
      }
      case '-h':
      case '--help': {
        usage();
        process.exit(0);
        break;
      }
      default: {
        process.stderr.write(`Unknown argument: ${arg}\n`);
        usage();
        process.exit(2);
      }
    }
  }

  if (!snapshot || !catalog) {
    process.stderr.write(
      'Both --snapshot and --catalog are required for generate.\n',
    );
    usage();
    process.exit(2);
  }

  return {
    command: 'generate',
    snapshot: resolve(snapshot),
    catalog: resolve(catalog),
    dryRun,
    edgesOnly,
    version,
    summaryOutput: summaryOutput ? resolve(summaryOutput) : undefined,
  };
}

function usage(): void {
  process.stderr.write(
    [
      'Usage:',
      '  autotel-eventcatalog drift --snapshot <path> --catalog <path> [options]',
      '  autotel-eventcatalog stamp --snapshot <path> --catalog <path> [--dry-run]',
      '  autotel-eventcatalog generate --snapshot <path> --catalog <path> [options]',
      '',
      'drift options:',
      '  --snapshot <path>        Path to the autotel architecture snapshot JSON',
      '  --base-snapshot <path>   Path to a baseline snapshot (typically PR base branch).',
      '  --catalog <path>         Path to the EventCatalog root',
      '  --output <path>          Write the report to this file',
      '  --summary-output <path>  Write a machine-readable drift summary JSON file',
      "  --policy <mode>          Drift fail policy: 'all' | 'new-only'",
      `  --format <kind>          Output format: ${RENDERER_NAMES.join(' | ')}`,
      '  --fail-on-drift          Exit non-zero when policy marks drift as failing',
      '',
      'stamp options:',
      '  --snapshot <path>        Architecture snapshot JSON',
      '  --catalog <path>         EventCatalog root',
      '  --dry-run                Print the update plan without writing files',
      '  --summary-output <path>  Write a machine-readable stamp summary JSON file',
      '',
      'generate options:',
      '  --snapshot <path>        Architecture snapshot JSON',
      '  --catalog <path>         EventCatalog root',
      '  --dry-run                Print the generation plan without writing files',
      '  --edges-only             Only generate producer/event/channel edges',
      '  --summary-output <path>  Write a machine-readable generate summary JSON file',
      '',
      '  -h, --help               Show this help',
      '',
    ].join('\n'),
  );
}

async function runDrift(args: DriftArgs): Promise<void> {
  const headSnapshot = await loadSnapshot(args.snapshot);
  const catalog = await readCatalogState(args.catalog);
  const headReport = diffCatalogAgainstSnapshot(headSnapshot, catalog);

  const delta = args.baseSnapshot
    ? compareDriftReports(
        diffCatalogAgainstSnapshot(
          await loadSnapshot(args.baseSnapshot),
          catalog,
        ),
        headReport,
      )
    : undefined;

  // Effective policy: explicit flag wins; otherwise derive from whether a
  // baseline snapshot is present.
  const effectivePolicy: DriftPolicyMode =
    args.policy ?? (delta ? 'new-only' : 'all');

  const policyResult =
    effectivePolicy === 'new-only' && delta
      ? evaluatePolicy({ mode: 'new-only', delta })
      : evaluatePolicy({ mode: 'all', report: headReport });

  // Dispatch through the renderer registry. Every renderer implements both
  // shapes; the right one is picked based on the effective policy.
  const renderer = getRenderer(args.format);
  if (!renderer) {
    // Defensive — parseDriftArgs already validates this, but make the
    // runtime failure mode unambiguous.
    process.stderr.write(`Unknown renderer: ${args.format}\n`);
    process.exit(2);
  }
  const output =
    effectivePolicy === 'new-only' && delta
      ? renderer.renderDelta(delta)
      : renderer.renderReport(headReport);

  process.stdout.write(output);
  if (!output.endsWith('\n')) process.stdout.write('\n');

  if (args.output) {
    await mkdir(dirname(args.output), { recursive: true });
    await writeFile(args.output, output, 'utf8');
    process.stderr.write(`\nWrote drift report: ${args.output}\n`);
  }

  const summary = buildSummary(
    effectivePolicy,
    headReport,
    delta,
    policyResult,
  );
  if (args.summaryOutput) {
    await mkdir(dirname(args.summaryOutput), { recursive: true });
    await writeFile(
      args.summaryOutput,
      JSON.stringify(summary, null, 2),
      'utf8',
    );
    process.stderr.write(`Wrote drift summary: ${args.summaryOutput}\n`);
  }

  // Always surface the policy outcome to stderr so CI logs explain *why*
  // the job ended the way it did. A "No drift detected" log line is as
  // useful as a "Drift detected" line when reading a CI run after the fact.
  process.stderr.write(`\n${policyResult.reason}\n`);

  if (args.failOnDrift && policyResult.shouldFail) {
    process.exit(1);
  }
}

const DRIFT_SUMMARY_SPEC = 'autotel-eventcatalog-drift-summary/v0.2.0' as const;

type DriftSummary = {
  spec: typeof DRIFT_SUMMARY_SPEC;
  mode: DriftPolicyMode;
  shouldFail: boolean;
  reason: string;
  counts: ReturnType<typeof countDriftReport>;
};

function buildSummary(
  mode: DriftPolicyMode,
  headReport: ReturnType<typeof diffCatalogAgainstSnapshot>,
  delta: ReturnType<typeof compareDriftReports> | undefined,
  policyResult: ReturnType<typeof evaluatePolicy>,
): DriftSummary {
  const counts =
    mode === 'new-only' && delta
      ? countDriftEntries(delta.introduced)
      : countDriftReport(headReport);
  return {
    spec: DRIFT_SUMMARY_SPEC,
    mode,
    shouldFail: policyResult.shouldFail,
    reason: policyResult.reason,
    counts,
  };
}

async function runStamp(args: StampArgs): Promise<void> {
  const snapshot = await loadSnapshot(args.snapshot);
  const result = await stampCatalog({
    snapshot,
    catalogPath: args.catalog,
    dryRun: args.dryRun,
  });

  for (const upd of result.updates) {
    const verb = args.dryRun
      ? `would ${upd.action}`
      : upd.changed
        ? upd.action
        : 'unchanged';
    process.stdout.write(`${verb} ${upd.catalogId} -> ${upd.filePath}\n`);
  }
  for (const skip of result.skips) {
    process.stdout.write(`skip ${skip.snapshotName} (${skip.reason})\n`);
  }

  const summary = buildStampSummary(result, args.dryRun);
  process.stderr.write(
    `\n${summary.changedFiles} changed, ${summary.replaces} replaces, ${summary.inserts} inserts, ${summary.skipped} skipped${
      args.dryRun ? ' (dry run)' : ''
    }\n`,
  );

  if (args.summaryOutput) {
    await mkdir(dirname(args.summaryOutput), { recursive: true });
    await writeFile(
      args.summaryOutput,
      JSON.stringify(summary, null, 2),
      'utf8',
    );
    process.stderr.write(`Wrote stamp summary: ${args.summaryOutput}\n`);
  }
}

async function runGenerate(args: GenerateArgs): Promise<void> {
  const snapshot = await loadSnapshot(args.snapshot);
  const result = await generateCatalogFromSnapshot({
    snapshot,
    catalogPath: args.catalog,
    dryRun: args.dryRun,
    edgesOnly: args.edgesOnly,
    version: args.version,
  });

  for (const op of result.operations) {
    const suffix = op.schemaSource ? ` (schema: ${op.schemaSource})` : '';
    process.stdout.write(`${op.action} ${op.kind} ${op.id}${suffix}\n`);
  }
  if (result.operations.length === 0) {
    process.stdout.write('No generation operations needed.\n');
  }

  if (args.summaryOutput) {
    const summary = buildGenerateSummary(result, {
      dryRun: args.dryRun,
      edgesOnly: args.edgesOnly,
    });
    await mkdir(dirname(args.summaryOutput), { recursive: true });
    await writeFile(
      args.summaryOutput,
      JSON.stringify(summary, null, 2),
      'utf8',
    );
    process.stderr.write(`Wrote generate summary: ${args.summaryOutput}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'stamp') {
    await runStamp(args);
    return;
  }
  if (args.command === 'generate') {
    await runGenerate(args);
    return;
  }
  await runDrift(args);
}

main().catch((error) => {
  process.stderr.write(`autotel-eventcatalog: ${(error as Error).message}\n`);
  process.exit(1);
});

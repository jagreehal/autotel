/**
 * Command-line flag parsing.
 *
 * The README has always documented `npx autotel-mcp --transport http --port 3000`
 * and `npx autotel-mcp --persist ./autotel.db`. Until this module existed those
 * flags were read by nobody: configuration came from the environment only, so
 * the documented invocation started a stdio server on the default ports and
 * said nothing about it.
 *
 * Parsing is pure and returns errors rather than calling `process.exit`, so the
 * CLI can report them and a library caller can decide for itself.
 */

/**
 * Flag name to the environment variable it overrides.
 *
 * @internal Exported so the help text can be checked against it rather than
 * against a second hand-written list that drifts.
 */
export const VALUE_FLAGS = new Map<string, string>([
  ['--backend', 'AUTOTEL_BACKEND'],
  ['-b', 'AUTOTEL_BACKEND'],
  ['--transport', 'AUTOTEL_TRANSPORT'],
  ['-t', 'AUTOTEL_TRANSPORT'],
  ['--port', 'AUTOTEL_PORT'],
  ['-p', 'AUTOTEL_PORT'],
  ['--host', 'AUTOTEL_HOST'],
  ['-H', 'AUTOTEL_HOST'],
  ['--allowed-hosts', 'AUTOTEL_ALLOWED_HOSTS'],
  ['--allowed-origins', 'AUTOTEL_ALLOWED_ORIGINS'],
  ['--collector-port', 'AUTOTEL_COLLECTOR_PORT'],
  ['--persist', 'AUTOTEL_PERSIST'],
  ['--retention-ms', 'AUTOTEL_RETENTION_MS'],
  ['--max-traces', 'AUTOTEL_MAX_TRACES'],
  ['--fixture', 'AUTOTEL_FIXTURE_PATH'],
  ['--jaeger-url', 'JAEGER_BASE_URL'],
  ['--devtools-url', 'DEVTOOLS_BASE_URL'],
  ['--tempo-url', 'TEMPO_BASE_URL'],
  ['--prometheus-url', 'PROMETHEUS_BASE_URL'],
  ['--loki-url', 'LOKI_BASE_URL'],
  ['--logfire-url', 'LOGFIRE_BASE_URL'],
  ['--signoz-url', 'SIGNOZ_BASE_URL'],
  // A region hostname, not a secret. autotel-cli exposes it as a flag too.
  ['--datadog-site', 'DD_SITE'],
]);

/**
 * Credentials stay out of argv on purpose: the process table is readable by
 * any other process on the box. Naming them here turns a leak into an error
 * message that says where to put them instead.
 */
const ENV_ONLY = new Map<string, string>([
  ['--logfire-token', 'LOGFIRE_READ_TOKEN'],
  ['--datadog-api-key', 'DD_API_KEY'],
  ['--datadog-app-key', 'DD_APP_KEY'],
  ['--signoz-api-key', 'SIGNOZ_API_KEY'],
]);

export interface ParsedArgs {
  /** Environment-shaped overrides, highest precedence. */
  overrides: Record<string, string>;
  help: boolean;
  version: boolean;
  /** Fatal: a flag of ours used wrongly. */
  errors: string[];
  /** Non-fatal: flags we do not know about. */
  warnings: string[];
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const overrides: Record<string, string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }

    // `--flag=value` is as common as `--flag value`; accept both.
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);

    const envOnly = ENV_ONLY.get(name);
    if (envOnly) {
      errors.push(
        `${name} is not accepted on the command line because argv is visible ` +
          `to every process on this machine. Set ${envOnly} instead.`,
      );
      if (inlineValue === undefined) index += 1;
      continue;
    }

    const envName = VALUE_FLAGS.get(name);
    if (!envName) {
      // Not fatal. argv was read by nobody until this module existed, so MCP
      // client configs already in the wild carry flags we never defined;
      // refusing to start would break them for a typo we can just report.
      warnings.push(`unknown option ignored: ${name}`);
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (
      value === undefined ||
      (inlineValue === undefined && value.startsWith('-'))
    ) {
      errors.push(`${name} requires a value`);
      continue;
    }
    overrides[envName] = value;
    if (inlineValue === undefined) index += 1;
  }

  return { overrides, help, version, errors, warnings };
}

export function helpText(): string {
  return `autotel-mcp - MCP server for OpenTelemetry traces, metrics and logs

Usage: autotel-mcp [options]

Options:
  -b, --backend <name>       collector (default), jaeger, devtools, tempo,
                             prometheus, loki, stack, auto, fixture, logfire,
                             datadog, signoz            [AUTOTEL_BACKEND]
  -t, --transport <name>     stdio (default), http    [AUTOTEL_TRANSPORT]
  -p, --port <port>          MCP HTTP port, default 3000        [AUTOTEL_PORT]
  -H, --host <host>          MCP HTTP bind address, default 127.0.0.1
                                                               [AUTOTEL_HOST]
      --allowed-hosts <list> Comma-separated hostnames the HTTP endpoint
                             answers for, no scheme or port, default
                             localhost only          [AUTOTEL_ALLOWED_HOSTS]
      --allowed-origins <l>  Comma-separated hostnames of browser origins
                             allowed to call it (app.example.com, not
                             https://app.example.com), default localhost
                             only                  [AUTOTEL_ALLOWED_ORIGINS]
      --collector-port <n>   OTLP receiver port, default 4318
                                                     [AUTOTEL_COLLECTOR_PORT]
      --persist <path>       libsql file; omit to stay in memory
                                                            [AUTOTEL_PERSIST]
      --retention-ms <n>     Data retention window     [AUTOTEL_RETENTION_MS]
      --max-traces <n>       Traces kept before eviction  [AUTOTEL_MAX_TRACES]
      --fixture <path>       Fixture backend data     [AUTOTEL_FIXTURE_PATH]
      --jaeger-url <url>     Jaeger API base URL          [JAEGER_BASE_URL]
      --devtools-url <url>   autotel-devtools base URL  [DEVTOOLS_BASE_URL]
      --tempo-url <url>      Tempo base URL                [TEMPO_BASE_URL]
      --prometheus-url <url> Prometheus base URL      [PROMETHEUS_BASE_URL]
      --loki-url <url>       Loki base URL                  [LOKI_BASE_URL]
      --logfire-url <url>    Logfire base URL            [LOGFIRE_BASE_URL]
      --signoz-url <url>     SigNoz base URL              [SIGNOZ_BASE_URL]
      --datadog-site <host>  Datadog region, e.g. datadoghq.eu     [DD_SITE]
  -h, --help                 Show this help
  -v, --version              Show version

Flags override environment variables, which override defaults.

Credentials are read from the environment only, never from flags, because argv
is visible to any process that can list the process table:
  LOGFIRE_READ_TOKEN, DD_API_KEY, DD_APP_KEY, SIGNOZ_API_KEY

Unknown flags are reported on stderr and ignored, not treated as errors.

Examples:
  npx autotel-mcp
  npx autotel-mcp --persist ./autotel.db
  npx autotel-mcp --transport http --port 3000
  npx autotel-mcp --backend jaeger --jaeger-url http://localhost:16686
`;
}

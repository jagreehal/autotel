import { AutotelErrorCodes, type AutotelErrorCode } from './errors';

/**
 * Per-command metadata. Agents read this via `autotel schema --json` to
 * discover the surface, side-effects, and which flags exist.
 *
 * Source of truth: this file. A drift test (manifest.test.ts) verifies the
 * commander dispatcher matches.
 */
export interface FlagSpec {
  name: string;
  alias?: string;
  takesValue?: boolean;
  description: string;
  default?: string | boolean;
}

export interface CommandSpec {
  name: string;
  description: string;
  args?: { name: string; required: boolean; description: string }[];
  flags: FlagSpec[];
  /** True when the command mutates files or installs packages. */
  mutating: boolean;
  /** True when the command makes network requests (e.g. installs). */
  network: boolean;
  /** True when the command writes files to disk. */
  writesFiles: boolean;
  /** True when --dry-run is honoured. */
  supportsDryRun: boolean;
  /** True when the command needs a package.json in scope. */
  requiresPackageJson: boolean;
  /** True when the command may read .env files (consent-gated). */
  mayReadEnv: boolean;
  /** True when the command emits machine-readable JSON via --json. */
  supportsJson: boolean;
  examples?: { description: string; command: string }[];
}

const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: '--cwd',
    takesValue: true,
    description: 'Target directory (default: current working directory)',
  },
  { name: '--verbose', description: 'Show detailed output' },
  { name: '--quiet', description: 'Only show warnings and errors' },
];

const AGENT_FLAGS: FlagSpec[] = [
  {
    name: '--json',
    description: 'Emit machine-readable JSON instead of human output',
  },
  {
    name: '--output-file',
    takesValue: true,
    description: 'Persist the first JSON payload to this path',
  },
  {
    name: '--no-secrets-in-output',
    description:
      'Redact secret-shaped values (also via AUTOTEL_NO_SECRETS=1 / AGENT_SANDBOX=1)',
  },
  {
    name: '--no-interactive',
    description: 'Never prompt; fail fast if input is required',
  },
];

export const COMMANDS: CommandSpec[] = [
  {
    name: 'init',
    description: 'Initialise autotel in your project',
    flags: [
      ...GLOBAL_FLAGS,
      ...AGENT_FLAGS,
      { name: '--dry-run', description: 'Print what would be done; write nothing' },
      { name: '--no-install', description: 'Generate files only, skip package installation' },
      { name: '--print-install-cmd', description: 'Output install command without running it' },
      { name: '--yes', alias: '-y', description: 'Auto-apply detected items; no prompts' },
      { name: '--preset', takesValue: true, description: 'Use a named quick preset' },
      { name: '--force', description: 'Overwrite existing config (creates backup)' },
      { name: '--workspace-root', description: 'Install at workspace root, not package root' },
      { name: '--no-detect', description: 'Skip auto-detection of installed deps' },
      { name: '--detect-only', description: 'Run detection and print the proposal; write nothing' },
      { name: '--plan', takesValue: true, description: 'Read a pre-built InitPlan JSON from this path and apply it' },
      { name: '--input', takesValue: true, description: 'Read InitPlan JSON from stdin (-) or a file' },
      { name: '--scan-env', description: 'Consent to reading uncommitted .env files for backend detection' },
    ],
    mutating: true,
    network: true,
    writesFiles: true,
    supportsDryRun: true,
    requiresPackageJson: true,
    mayReadEnv: true,
    supportsJson: true,
    examples: [
      { description: 'Interactive setup with detection', command: 'autotel init' },
      { description: 'Non-interactive, apply all detected items', command: 'autotel init --yes' },
      { description: 'Preview as JSON without writing', command: 'autotel init --json --dry-run' },
      { description: 'Detection only', command: 'autotel init --detect-only --json' },
    ],
  },
  {
    name: 'doctor',
    description: 'Run diagnostics on your autotel setup',
    flags: [
      ...GLOBAL_FLAGS,
      ...AGENT_FLAGS,
      { name: '--fix', description: 'Auto-fix resolvable issues' },
      { name: '--list-checks', description: 'List all available checks' },
      { name: '--env-file', takesValue: true, description: 'Path to env file to check' },
    ],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: true,
    mayReadEnv: true,
    supportsJson: true,
  },
  {
    name: 'add',
    description: 'Add a backend, subscriber, plugin, or platform incrementally',
    args: [
      { name: 'type', required: false, description: 'Preset type' },
      { name: 'name', required: false, description: 'Preset name' },
    ],
    flags: [
      ...GLOBAL_FLAGS,
      ...AGENT_FLAGS,
      { name: '--list', description: 'List available presets for the given type' },
      { name: '--dry-run', description: 'Print what would be done' },
      { name: '--no-install', description: 'Generate files only' },
      { name: '--print-install-cmd', description: 'Output install command without running' },
      { name: '--yes', alias: '-y', description: 'Accept defaults' },
      { name: '--force', description: 'Overwrite non-CLI-owned config' },
      { name: '--workspace-root', description: 'Install at workspace root' },
    ],
    mutating: true,
    network: true,
    writesFiles: true,
    supportsDryRun: true,
    requiresPackageJson: true,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'codemod trace',
    description: 'Wrap functions in trace() with span name from function/variable/method name',
    args: [{ name: 'path', required: true, description: 'File path or glob' }],
    flags: [
      ...GLOBAL_FLAGS,
      { name: '--dry-run', description: 'Print changes without writing files' },
      { name: '--name-pattern', takesValue: true, description: 'Span name template' },
      { name: '--skip', takesValue: true, description: 'Skip functions whose name matches (repeatable)' },
      { name: '--print-files', description: 'Print per-file summary' },
    ],
    mutating: true,
    network: false,
    writesFiles: true,
    supportsDryRun: true,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: false,
  },
  {
    name: 'schema',
    description: 'Print the CLI manifest as JSON (agent discovery)',
    flags: [
      { name: '--json', description: 'Always JSON (this command is JSON-only)' },
    ],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'schema errors',
    description: 'Print error envelope shape + AUTOTEL_E_* enum',
    flags: [{ name: '--json', description: 'Always JSON' }],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'schema outputs',
    description: 'Print JSON output shapes per command',
    flags: [{ name: '--json', description: 'Always JSON' }],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'commands',
    description: 'Print compact tool-style command listing',
    flags: [{ name: '--json', description: 'Always JSON' }],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'examples',
    description: 'Print copy-pasteable examples for a command',
    args: [
      { name: 'command', required: false, description: 'Command name (omit for all)' },
    ],
    flags: [{ name: '--json', description: 'Emit JSON' }],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
  {
    name: 'version',
    description: 'Print version info',
    flags: [{ name: '--json', description: 'Emit JSON' }],
    mutating: false,
    network: false,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  },
];

// Investigate commands — mirror autotel-mcp tools. All emit JSON, none
// mutate files. Backend-touching commands set network: true. Schemas are
// terse (full flag docs live in the runtime); the manifest exists for agent
// discoverability + drift-test parity with the dispatcher.
const INVESTIGATE_FLAGS: FlagSpec[] = [
  { name: '--backend', takesValue: true, description: 'Backend kind (env: AUTOTEL_BACKEND)' },
  { name: '--jaeger-base-url', takesValue: true, description: 'Jaeger base URL' },
  { name: '--tempo-base-url', takesValue: true, description: 'Tempo base URL' },
  { name: '--prometheus-base-url', takesValue: true, description: 'Prometheus base URL' },
  { name: '--loki-base-url', takesValue: true, description: 'Loki base URL' },
  { name: '--collector-port', takesValue: true, description: 'OTLP receiver port' },
  { name: '--fixture-path', takesValue: true, description: 'Fixture JSON path' },
  { name: '--output-file', takesValue: true, description: 'Persist JSON output to this path' },
  { name: '--no-secrets-in-output', description: 'Redact secret-shaped values' },
];

const STATIC_FLAGS: FlagSpec[] = [
  { name: '--output-file', takesValue: true, description: 'Persist JSON output to this path' },
  { name: '--no-secrets-in-output', description: 'Redact secret-shaped values' },
];

function investigateCmd(
  name: string,
  description: string,
  extras: {
    args?: CommandSpec['args'];
    flags?: FlagSpec[];
    network?: boolean;
    static?: boolean;
  } = {},
): CommandSpec {
  return {
    name,
    description,
    ...(extras.args ? { args: extras.args } : {}),
    flags: [...(extras.static ? STATIC_FLAGS : INVESTIGATE_FLAGS), ...(extras.flags ?? [])],
    mutating: false,
    network: extras.network ?? !extras.static,
    writesFiles: false,
    supportsDryRun: false,
    requiresPackageJson: false,
    mayReadEnv: false,
    supportsJson: true,
  };
}

const traceIdArg: NonNullable<CommandSpec['args']> = [
  { name: 'traceId', required: true, description: 'Trace ID' },
];
const serviceNameArg: NonNullable<CommandSpec['args']> = [
  { name: 'serviceName', required: true, description: 'Service name' },
];

const INVESTIGATE_COMMANDS: CommandSpec[] = [
  investigateCmd('health', 'Backend health + signal coverage'),
  investigateCmd('capabilities', 'Which signals the active backend serves'),

  investigateCmd('discover', 'Discover services and field shapes (parent)'),
  investigateCmd('discover services', 'Services with cross-signal metadata'),
  investigateCmd('discover trace-fields', 'Trace/span field names from sampled traces', {
    flags: [{ name: '--search', takesValue: true, description: 'Substring filter' }],
  }),
  investigateCmd('discover log-fields', 'Log field names from sampled logs', {
    flags: [{ name: '--search', takesValue: true, description: 'Substring filter' }],
  }),

  investigateCmd('query', 'Query traces/spans/metrics/logs (parent)'),
  investigateCmd('query traces', 'Search traces by service/op/status/tags/time/error'),
  investigateCmd('query spans', 'Search individual spans (extra duration filters)'),
  investigateCmd('query metrics', 'List metric series'),
  investigateCmd('query logs', 'Search logs'),

  investigateCmd('trace', 'Trace lookup commands (parent)'),
  investigateCmd('trace get', 'Get a trace by ID', { args: traceIdArg }),
  investigateCmd('trace summary', 'Compact incident-friendly trace summary', { args: traceIdArg }),

  investigateCmd('topology', 'Service topology commands (parent)'),
  investigateCmd('topology services', 'List known services'),
  investigateCmd('topology operations', 'List operations for a service', { args: serviceNameArg }),
  investigateCmd('topology map', 'Service dependency map with node/edge health'),

  investigateCmd('diagnose', 'Anomaly / root-cause / errors / SLO diagnosis (parent)'),
  investigateCmd('diagnose anomalies', 'Latency / error-rate outliers'),
  investigateCmd('diagnose root-cause', 'Bottleneck span in a trace', { args: traceIdArg }),
  investigateCmd('diagnose errors', 'Error spans grouped by service/operation'),
  investigateCmd('diagnose slos', 'SLO violations for a service'),

  investigateCmd('correlate', 'Cross-signal correlation (parent)'),
  investigateCmd('correlate trace', 'Trace + metrics + logs for a trace ID', { args: traceIdArg }),
  investigateCmd('correlate explain-slowdown', 'Anomalies + root cause + correlated signals'),

  investigateCmd('llm', 'LLM analytics (parent)'),
  investigateCmd('llm usage', 'Token usage + USD by model and service'),
  investigateCmd('llm models', 'Discover LLM models in use'),
  investigateCmd('llm model-stats', 'Per-model latency/token/error stats'),
  investigateCmd('llm expensive', 'Top token-spend traces'),
  investigateCmd('llm slow', 'Slowest LLM traces'),
  investigateCmd('llm tools', 'Tool/function spans grouped by tool name'),

  investigateCmd('semconv', 'Semantic conventions lookup (parent)', { static: true }),
  investigateCmd('semconv list', 'List semconv namespaces', { static: true, network: true }),
  investigateCmd('semconv get', 'Groups for one namespace', {
    static: true,
    network: true,
    args: [{ name: 'namespace', required: true, description: 'Namespace (e.g. http)' }],
  }),
  investigateCmd('semconv refresh', 'Clear semconv cache', { static: true }),

  investigateCmd('score', 'Score a span for instrumentation quality (JSON on stdin)', {
    static: true,
    flags: [{ name: '--span-file', takesValue: true, description: 'Read span JSON from file' }],
  }),
  investigateCmd('score explain', 'Explain the instrumentation scoring rubric', { static: true }),

  investigateCmd('collector', 'OpenTelemetry Collector config + schema commands (parent)', {
    static: true,
  }),
  investigateCmd('collector validate', 'Validate OTLP receiver config', {
    static: true,
    flags: [{ name: '--config-file', takesValue: true, description: 'Read JSON config from file' }],
  }),
  investigateCmd('collector suggest', 'Minimal OTLP receiver config', { static: true }),
  investigateCmd('collector explain', 'Receiver config shape + defaults', { static: true }),
  investigateCmd('collector versions', 'Supported collector schema versions', { static: true, network: true }),
  investigateCmd('collector components', 'Components for a version', {
    static: true,
    network: true,
    flags: [
      { name: '--version', takesValue: true, description: 'Collector version' },
      { name: '--kind', takesValue: true, description: 'Component kind filter' },
    ],
  }),
  investigateCmd('collector schema', 'JSON schema for a component', {
    static: true,
    network: true,
    flags: [
      { name: '--kind', takesValue: true, description: 'Component kind' },
      { name: '--name', takesValue: true, description: 'Component name' },
      { name: '--version', takesValue: true, description: 'Collector version' },
    ],
  }),
  investigateCmd('collector readme', 'README for a component', {
    static: true,
    network: true,
    flags: [
      { name: '--kind', takesValue: true, description: 'Component kind' },
      { name: '--name', takesValue: true, description: 'Component name' },
      { name: '--version', takesValue: true, description: 'Collector version' },
    ],
  }),
  investigateCmd('collector validate-component', 'Validate component config against upstream schema', {
    static: true,
    network: true,
    flags: [
      { name: '--kind', takesValue: true, description: 'Component kind' },
      { name: '--name', takesValue: true, description: 'Component name' },
      { name: '--version', takesValue: true, description: 'Collector version' },
      { name: '--config-file', takesValue: true, description: 'Read JSON config from file' },
    ],
  }),
  investigateCmd('collector refresh', 'Refresh in-memory collector metadata cache', { static: true, network: true }),
];

COMMANDS.push(...INVESTIGATE_COMMANDS);

export function getCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}

export interface ErrorCodeEntry {
  code: AutotelErrorCode;
  type: string;
  description: string;
}

/** Public catalogue of AUTOTEL_E_* codes for `autotel schema errors`. */
export const ERROR_CATALOGUE: ErrorCodeEntry[] = [
  { code: AutotelErrorCodes.E_NO_PACKAGE_JSON, type: 'environment', description: 'No package.json found in cwd or ancestors' },
  { code: AutotelErrorCodes.E_UNKNOWN_PRESET, type: 'validation', description: 'Preset slug not in registry' },
  { code: AutotelErrorCodes.E_INVALID_PLAN, type: 'validation', description: 'Plan file failed schema validation' },
  { code: AutotelErrorCodes.E_INVALID_INPUT, type: 'validation', description: 'Stdin or --input payload invalid' },
  { code: AutotelErrorCodes.E_INVALID_FLAG, type: 'validation', description: 'Conflicting or invalid flag combination' },
  { code: AutotelErrorCodes.E_NO_WORKSPACE_PACKAGES, type: 'environment', description: 'Workspace root has no detectable packages' },
  { code: AutotelErrorCodes.E_ENV_CONSENT_REQUIRED, type: 'environment', description: '.env file present; consent required (pass --scan-env or run interactively)' },
  { code: AutotelErrorCodes.E_EXISTING_CONFIG, type: 'conflict', description: 'Existing instrumentation config; use --force or run with merge' },
  { code: AutotelErrorCodes.E_AMBIGUOUS_LOGGER, type: 'conflict', description: 'Multiple loggers detected and selection could not be inferred' },
  { code: AutotelErrorCodes.E_INSTALL_FAILED, type: 'install', description: 'Package manager install command failed' },
  { code: AutotelErrorCodes.E_WRITE_FAILED, type: 'io', description: 'Failed to write a file' },
  { code: AutotelErrorCodes.E_READ_FAILED, type: 'io', description: 'Failed to read a file' },
  { code: AutotelErrorCodes.E_UNKNOWN, type: 'runtime', description: 'Unexpected error' },
];

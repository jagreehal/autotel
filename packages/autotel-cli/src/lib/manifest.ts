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

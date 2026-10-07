// src/agent-setup.ts
//
// `autotel-devtools agents enable|disable|status`: route coding agents to this
// receiver persistently, by editing their own config files, so every new
// session shows up in the Agents tab without a wrapper.
//
// Ownership rule: we record exactly what we wrote. `disable` removes a value
// only while it still equals that record; anything the user changed since is
// theirs and stays. Previous destinations are not saved, so not restored.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { REPOSITORY_EVENT } from 'autotel-agents';

export const AGENT_TARGETS = ['claude-code', 'codex'] as const;
export type AgentTarget = (typeof AGENT_TARGETS)[number];

/**
 * What a session's SessionStart hook reports about its repository: `path`
 * sends the name and the canonical path, `name` the name only, `off` installs
 * no hook. No agent reports its working directory itself.
 */
export const REPOSITORY_MODES = ['path', 'name', 'off'] as const;
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

// Telemetry env that wires Claude Code (and any OTel-via-env CLI) to this
// receiver for a live local view. HTTP/protobuf remains the most portable
// Claude Code configuration; the same receiver also accepts OTLP/gRPC.
// session.id kept on metrics so metric-only signals join their session.
export function buildAgentEnv(
  uiBase: string,
  logPrompts: boolean,
): Record<string, string> {
  const env = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    // Spans are beta-gated. Without this the interaction → llm_request → tool
    // hierarchy, and the sub-agent tree `parent_agent_id` draws inside it, is
    // never emitted — metrics and logs cannot reconstruct either.
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: uiBase,
    OTEL_METRIC_EXPORT_INTERVAL: '1000',
    OTEL_LOGS_EXPORT_INTERVAL: '1000',
    OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
  };
  // Private by default: prompt *text* only flows when explicitly opted in.
  return logPrompts ? { ...env, OTEL_LOG_USER_PROMPTS: '1' } : env;
}

interface ClaudeState {
  path: string;
  endpoint: string;
  /** env key → the value we wrote. */
  values: Record<string, string>;
  /** Repository mode the hook reads at run time; absent when `off`. */
  repository?: 'path' | 'name';
  /** The SessionStart hook command we registered, when we did. */
  hookCommand?: string;
}
interface CodexState {
  path: string;
  endpoint: string;
  /** The exact managed block we appended. */
  block: string;
}
interface State {
  'claude-code'?: ClaudeState;
  codex?: CodexState;
}

export interface SetupResult {
  ok: boolean;
  lines: string[];
}

const CODEX_BEGIN =
  '# BEGIN AUTOTEL DEVTOOLS (managed: autotel-devtools agents)';
const CODEX_END = '# END AUTOTEL DEVTOOLS';
const DESKTOP_NOTE =
  "note: Claude Desktop's Setup profile overrides user settings; route it there separately";

const env = (key: string) => process.env[key]?.trim() || undefined;
const home = () => env('HOME') ?? homedir();

export function claudeSettingsPath(): string {
  return join(
    env('CLAUDE_CONFIG_DIR') ?? join(home(), '.claude'),
    'settings.json',
  );
}
export function codexConfigPath(): string {
  return join(env('CODEX_HOME') ?? join(home(), '.codex'), 'config.toml');
}
export function statePath(): string {
  return join(
    env('XDG_CONFIG_HOME') ?? join(home(), '.config'),
    'autotel-devtools',
    'agents.json',
  );
}

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/**
 * temp file + rename, so a crash never leaves a half-written config. These
 * files can hold API keys and OTLP auth headers, so the rewrite keeps the
 * original's permissions and a new file starts owner-only.
 */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const tmp = `${path}.autotel-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600, flag: 'w' });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

function readState(): State {
  const text = readText(statePath());
  // SAFETY: only writeState writes this file, always from a State.
  return text ? (JSON.parse(text) as State) : {};
}
function writeState(state: State): void {
  writeAtomic(statePath(), JSON.stringify(state, null, 2) + '\n');
}

const scalarText = (v: Json | undefined) =>
  v === undefined || v === null || v instanceof Object ? undefined : String(v);

const truthy = (v: Json | undefined) => {
  const text = String(v ?? '')
    .trim()
    .toLowerCase();
  return text === '1' || text === 'true';
};

// ── Claude Code: settings.json `env` ──────────────────────────────────────

type Json = string | number | boolean | null | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

// JSON.parse only ever builds plain objects, so instanceof Object is enough.
const isJsonObject = (value: Json | undefined): value is JsonObject =>
  value instanceof Object && !Array.isArray(value);

function readClaudeSettings(path: string): JsonObject {
  const text = readText(path);
  if (!text?.trim()) return {};
  // SAFETY: JSON.parse returns a JSON value, which is what Json describes.
  const parsed = JSON.parse(text) as Json;
  if (!isJsonObject(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

function claudeEnvOf(settings: JsonObject): JsonObject {
  return isJsonObject(settings.env) ? { ...settings.env } : {};
}

/** What we want in `env`, given what is there now. */
function claudeWanted(
  current: JsonObject,
  base: string,
  logPrompts: boolean,
): Record<string, string> {
  const wanted = buildAgentEnv(base, logPrompts);
  // A signal-specific endpoint beats the generic one, and one can be inherited
  // from the shell, MDM or a managed settings file we never see. Pinning all
  // three here wins regardless of where the other came from.
  for (const signal of ['LOGS', 'TRACES', 'METRICS'] as const) {
    wanted[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] =
      `${base}/v1/${signal.toLowerCase()}`;
  }
  if (
    truthy(current.OTEL_SDK_DISABLED) ||
    truthy(process.env.OTEL_SDK_DISABLED)
  )
    wanted.OTEL_SDK_DISABLED = 'false';
  // An active detailed-beta pair overrides the standard logs/traces exporters.
  const beta =
    current.ENABLE_BETA_TRACING_DETAILED ??
    process.env.ENABLE_BETA_TRACING_DETAILED;
  const betaEndpoint =
    current.BETA_TRACING_ENDPOINT ?? process.env.BETA_TRACING_ENDPOINT;
  if (truthy(beta) && betaEndpoint) {
    wanted.ENABLE_BETA_TRACING_DETAILED = '1';
    wanted.BETA_TRACING_ENDPOINT = base;
  }
  return wanted;
}

type HookGroup = { matcher?: string; hooks?: { command?: string }[] };

const sessionStartGroups = (settings: JsonObject): JsonObject[] => {
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {};
  const groups = hooks.SessionStart;
  return Array.isArray(groups) ? groups.filter(isJsonObject) : [];
};

// SAFETY: a group is read for `hooks[].command` only, each guarded below.
const runsCommand = (group: JsonObject, command: string) =>
  ((group as HookGroup).hooks ?? []).some((hook) => hook?.command === command);

/** settings with the SessionStart group that runs `command` added or removed. */
function withSessionHook(
  settings: JsonObject,
  command: string,
  present: boolean,
): JsonObject {
  const hooks = isJsonObject(settings.hooks) ? { ...settings.hooks } : {};
  const others = sessionStartGroups(settings).filter(
    (group) => !runsCommand(group, command),
  );
  const groups: Json[] = present
    ? [
        ...others,
        {
          matcher: 'startup|resume',
          hooks: [{ type: 'command', command, timeout: 5 }],
        },
      ]
    : others;
  if (groups.length > 0) hooks.SessionStart = groups;
  else delete hooks.SessionStart;
  const { hooks: _previous, ...rest } = settings;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

function enableClaude(
  state: State,
  base: string,
  options: SetupOptions,
): string[] {
  const { logPrompts } = options;
  const path = claudeSettingsPath();
  const settings = readClaudeSettings(path);
  const current = claudeEnvOf(settings);
  const owned = state['claude-code']?.values ?? {};
  const values: Record<string, string> = {};
  for (const [key, want] of Object.entries(
    claudeWanted(current, base, logPrompts),
  )) {
    // A value the user already had, equal to ours, stays theirs.
    if (current[key] !== want || owned[key] === want) values[key] = want;
    current[key] = want;
  }
  // Keys we owned earlier but no longer want (e.g. --log-prompts dropped).
  for (const [key, was] of Object.entries(owned)) {
    if (!(key in values) && current[key] === was) delete current[key];
  }
  let next: JsonObject = { ...settings, env: current };
  const previousHook = state['claude-code']?.hookCommand;
  if (previousHook) next = withSessionHook(next, previousHook, false);
  const mode = options.repository ?? 'path';
  const hookCommand = mode === 'off' ? undefined : options.hookCommand;
  if (hookCommand) next = withSessionHook(next, hookCommand, true);
  writeAtomic(path, JSON.stringify(next, null, 2) + '\n');
  const record: ClaudeState = { path, endpoint: base, values };
  if (hookCommand && mode !== 'off') {
    record.repository = mode;
    record.hookCommand = hookCommand;
  }
  state['claude-code'] = record;
  return [
    `claude-code: enabled → ${base} (${path})`,
    hookCommand
      ? `  repository: ${mode} (SessionStart hook reports the session's repository)`
      : '  repository: off',
    `  ${DESKTOP_NOTE}`,
  ];
}

function disableClaude(state: State): string[] {
  const owned = state['claude-code'];
  if (!owned) return ['claude-code: nothing managed by autotel-devtools'];
  const lines: string[] = [];
  if (existsSync(owned.path)) {
    const settings = readClaudeSettings(owned.path);
    const current = claudeEnvOf(settings);
    for (const [key, was] of Object.entries(owned.values)) {
      if (current[key] === was) delete current[key];
      else if (key in current)
        lines.push(`  kept ${key}: changed since enable`);
    }
    const { env: _previous, ...rest } = settings;
    let next: JsonObject =
      Object.keys(current).length > 0 ? { ...rest, env: current } : rest;
    if (owned.hookCommand)
      next = withSessionHook(next, owned.hookCommand, false);
    writeAtomic(owned.path, JSON.stringify(next, null, 2) + '\n');
  }
  delete state['claude-code'];
  return [
    `claude-code: disabled (${owned.path}); previous destinations not restored`,
    ...lines,
  ];
}

function statusClaude(state: State): string[] {
  const owned = state['claude-code'];
  const path = owned?.path ?? claudeSettingsPath();
  if (!owned)
    return [`claude-code: not enabled (${path})`, `  ${DESKTOP_NOTE}`];
  const current = existsSync(path) ? claudeEnvOf(readClaudeSettings(path)) : {};
  const drifted = Object.entries(owned.values)
    .filter(([key, was]) => current[key] !== was)
    .map(([key]) => key);
  return [
    drifted.length > 0
      ? `claude-code: drifted → ${owned.endpoint} (changed: ${drifted.join(', ')})`
      : `claude-code: enabled → ${owned.endpoint} (${path})`,
    `  ${DESKTOP_NOTE}`,
  ];
}

// ── Codex: config.toml managed block ──────────────────────────────────────

function codexBlock(base: string, logPrompts: boolean): string {
  const exporter = (signal: string) =>
    `{ otlp-http = { endpoint = "${base}/v1/${signal}", protocol = "binary" } }`;
  return [
    CODEX_BEGIN,
    '[otel]',
    `exporter = ${exporter('logs')}`,
    `trace_exporter = ${exporter('traces')}`,
    `metrics_exporter = ${exporter('metrics')}`,
    ...(logPrompts ? ['log_user_prompt = true'] : []),
    CODEX_END,
  ].join('\n');
}

interface CodexSplit {
  /** Our managed block, markers included, when the file has one. */
  block?: string;
  rest: string;
}

/** Split the file into our managed block (if any) and everything else. */
function splitCodex(text: string): CodexSplit {
  const start = text.indexOf(CODEX_BEGIN);
  const endAt = text.indexOf(CODEX_END, start);
  if (start === -1 || endAt === -1) return { rest: text };
  const end = endAt + CODEX_END.length;
  const rest =
    text.slice(0, start).replace(/\n+$/, '\n') +
    text.slice(end).replace(/^\n+/, '');
  return { block: text.slice(start, end), rest: rest === '\n' ? '' : rest };
}

// Any otel table, array of tables, inline table or dotted key outside our block.
// A line match is enough here: anything otel-shaped is refused, so the file
// never ends up with a second [otel] table that Codex would reject.
const FOREIGN_OTEL =
  /^\s*(\[\[?\s*["']?otel["']?\s*[.\]]|["']?otel["']?\s*[.=])/m;

function enableCodex(
  state: State,
  base: string,
  logPrompts: boolean,
): SetupResult {
  const path = codexConfigPath();
  const { rest } = splitCodex(readText(path) ?? '');
  if (FOREIGN_OTEL.test(rest)) {
    return {
      ok: false,
      lines: [
        `codex: refused — ${path} already configures otel outside the autotel-devtools block.`,
        '  Remove or comment out that otel config, then re-run. Nothing was changed.',
      ],
    };
  }
  const block = codexBlock(base, logPrompts);
  const prefix =
    rest === '' ? '' : rest.endsWith('\n') ? `${rest}\n` : `${rest}\n\n`;
  writeAtomic(path, `${prefix}${block}\n`);
  state.codex = { path, endpoint: base, block };
  return {
    ok: true,
    lines: [`codex: enabled → ${base} (${path}); restart Codex processes`],
  };
}

function disableCodex(state: State): string[] {
  const owned = state.codex;
  if (!owned) return ['codex: nothing managed by autotel-devtools'];
  const text = readText(owned.path) ?? '';
  const { block, rest } = splitCodex(text);
  const lines = [
    `codex: disabled (${owned.path}); previous destinations not restored`,
  ];
  if (block === owned.block) writeAtomic(owned.path, rest);
  else if (block) lines.push('  kept the managed block: changed since enable');
  delete state.codex;
  return lines;
}

function statusCodex(state: State): string[] {
  const owned = state.codex;
  const path = owned?.path ?? codexConfigPath();
  const { block } = splitCodex(readText(path) ?? '');
  if (!owned) return [`codex: not enabled (${path})`];
  if (block !== owned.block)
    return [
      `codex: drifted → ${owned.endpoint} (managed block changed or removed)`,
    ];
  return [`codex: enabled → ${owned.endpoint} (${path})`];
}

// ── Entry ──────────────────────────────────────────────────────────────────

export function parseTargets(value: string | undefined): AgentTarget[] {
  if (!value) return [...AGENT_TARGETS];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const target = AGENT_TARGETS.find((known) => known === t);
      if (!target)
        throw new Error(
          `unknown --target ${t} (expected ${AGENT_TARGETS.join(', ')})`,
        );
      return target;
    });
}

export interface SetupOptions {
  endpoint: string;
  logPrompts: boolean;
  /** Default `path`. Claude Code only: Codex has no user-level hooks to add. */
  repository?: RepositoryMode;
  /** Command Claude Code runs at SessionStart; no hook is added without one. */
  hookCommand?: string;
}

export function runAgentSetup(
  action: 'enable' | 'disable' | 'status',
  targets: AgentTarget[],
  options: SetupOptions,
): SetupResult {
  const base = options.endpoint
    .replace(/\/+$/, '')
    .replace(/\/v1\/(logs|traces|metrics)$/, '');
  const state = readState();
  const result: SetupResult = { ok: true, lines: [] };
  for (const target of targets) {
    if (action === 'status') {
      result.lines.push(
        ...(target === 'codex' ? statusCodex(state) : statusClaude(state)),
      );
    } else if (action === 'disable') {
      result.lines.push(
        ...(target === 'codex' ? disableCodex(state) : disableClaude(state)),
      );
    } else if (target === 'codex') {
      const codex = enableCodex(state, base, options.logPrompts);
      result.ok &&= codex.ok;
      result.lines.push(...codex.lines);
    } else {
      result.lines.push(...enableClaude(state, base, options));
    }
  }
  if (action !== 'status') writeState(state);
  if (action === 'enable' && result.ok)
    result.lines.push(
      'Restart the agent and start a new session to pick this up.',
    );
  return result;
}

// ── SessionStart hook: tie the session to its repository ─────────────────

/**
 * The repository `cwd` sits in: the nearest directory holding `.git`. A
 * worktree's `.git` is a file pointing into the main repository's git dir, so
 * it resolves to the main checkout and every worktree reads as one repository.
 * Outside git, the working directory itself.
 */
export interface RepositoryIdentity {
  name: string;
  path: string;
}

export function repositoryOf(cwd: string): RepositoryIdentity {
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    const marker = join(dir, '.git');
    if (existsSync(marker)) {
      const path = mainCheckoutOf(marker) ?? dir;
      return { name: basename(path), path };
    }
    if (dirname(dir) === dir) break;
  }
  return { name: basename(start), path: start };
}

function mainCheckoutOf(marker: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(marker, 'utf8');
  } catch {
    return undefined; // a directory: this is the main checkout
  }
  const match = /^gitdir:\s*(.+)$/m.exec(text);
  if (!match) return undefined;
  const gitDir = resolve(dirname(marker), match[1].trim());
  const common = readText(join(gitDir, 'commondir'))?.trim();
  const commonDir = common
    ? isAbsolute(common)
      ? common
      : resolve(gitDir, common)
    : gitDir;
  return basename(commonDir) === '.git' ? dirname(commonDir) : undefined;
}

/**
 * Run as Claude Code's SessionStart hook: read the hook payload, send one
 * {@link REPOSITORY_EVENT} log record to the receiver `enable` recorded. Never
 * throws and never blocks the session for long: a hook that fails must not
 * cost the user their session.
 */
export async function runRepositoryHook(payloadText: string): Promise<void> {
  const owned = readState()['claude-code'];
  if (!owned?.repository) return;
  // SAFETY: JSON.parse returns a JSON value, which is what Json describes.
  const payload = JSON.parse(payloadText) as Json;
  if (!isJsonObject(payload)) return;
  const sessionId = scalarText(payload.session_id);
  const cwd = scalarText(payload.cwd);
  if (!sessionId || !cwd) return;
  const repo = repositoryOf(cwd);
  const attributes = [
    ['event.name', REPOSITORY_EVENT],
    ['session.id', sessionId],
    ['agent.kind', 'claude-code'],
    ['repository.name', repo.name],
  ];
  if (owned.repository === 'path')
    attributes.push(['repository.path', repo.path]);
  const body = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'autotel-devtools' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'autotel-devtools.agents' },
            logRecords: [
              {
                timeUnixNano: `${Date.now()}000000`,
                eventName: REPOSITORY_EVENT,
                body: { stringValue: REPOSITORY_EVENT },
                attributes: attributes.map(([key, value]) => ({
                  key,
                  value: { stringValue: value },
                })),
              },
            ],
          },
        ],
      },
    ],
  };
  await fetch(`${owned.endpoint}/v1/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
}

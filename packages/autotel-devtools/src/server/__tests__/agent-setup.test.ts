import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeSettingsPath,
  codexConfigPath,
  repositoryOf,
  runAgentSetup,
  runRepositoryHook,
} from '../../agent-setup';

const ENV_KEYS = [
  'HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'OTEL_SDK_DISABLED',
  'ENABLE_BETA_TRACING_DETAILED',
  'BETA_TRACING_ENDPOINT',
];
const opts = { endpoint: 'http://127.0.0.1:4318', logPrompts: false };
const read = (path: string) => readFileSync(path, 'utf8');
const claudeEnv = () =>
  // SAFETY: the code under test writes this file as a settings object.
  (JSON.parse(read(claudeSettingsPath())) as { env?: Record<string, string> })
    .env;

describe('agents enable / disable / status', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autotel-agents-'));
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HOME = dir;
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips Claude Code, keeping the user’s other settings', () => {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(
      claudeSettingsPath(),
      JSON.stringify({ model: 'opus', env: { FOO: 'bar' } }),
    );

    expect(runAgentSetup('enable', ['claude-code'], opts).ok).toBe(true);
    expect(claudeEnv()).toMatchObject({
      FOO: 'bar',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    });
    expect(runAgentSetup('status', ['claude-code'], opts).lines[0]).toMatch(
      /^claude-code: enabled/,
    );

    runAgentSetup('disable', ['claude-code'], opts);
    const settings = JSON.parse(read(claudeSettingsPath()));
    expect(settings).toEqual({ model: 'opus', env: { FOO: 'bar' } });
    expect(runAgentSetup('status', ['claude-code'], opts).lines[0]).toMatch(
      /not enabled/,
    );
  });

  it('keeps a private settings file private', () => {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(claudeSettingsPath(), '{}', { mode: 0o600 });
    runAgentSetup('enable', ['claude-code'], opts);
    expect(statSync(claudeSettingsPath()).mode & 0o777).toBe(0o600);
    runAgentSetup('enable', ['codex'], opts);
    expect(statSync(codexConfigPath()).mode & 0o777).toBe(0o600);
  });

  it('pins signal-specific endpoints even when none are in settings', () => {
    // One inherited from the shell or MDM would beat the generic endpoint.
    runAgentSetup('enable', ['claude-code'], opts);
    expect(claudeEnv()).toMatchObject({
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4318/v1/logs',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics',
    });
  });

  it('leaves a value the user changed after enable, and reports drift', () => {
    runAgentSetup('enable', ['claude-code'], opts);
    const settings = JSON.parse(read(claudeSettingsPath()));
    settings.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://corp.example';
    writeFileSync(claudeSettingsPath(), JSON.stringify(settings));

    expect(runAgentSetup('status', ['claude-code'], opts).lines[0]).toMatch(
      /drifted.*OTEL_EXPORTER_OTLP_ENDPOINT/,
    );
    const out = runAgentSetup('disable', ['claude-code'], opts).lines.join(
      '\n',
    );
    expect(out).toContain('kept OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(claudeEnv()).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://corp.example',
    });
  });

  it('takes over an active detailed-beta pair and a disabled SDK', () => {
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'cc');
    mkdirSync(process.env.CLAUDE_CONFIG_DIR);
    writeFileSync(
      claudeSettingsPath(),
      JSON.stringify({
        env: {
          ENABLE_BETA_TRACING_DETAILED: 'true',
          BETA_TRACING_ENDPOINT: 'https://elsewhere',
          OTEL_SDK_DISABLED: 'true',
        },
      }),
    );
    runAgentSetup('enable', ['claude-code'], opts);
    expect(claudeEnv()).toMatchObject({
      ENABLE_BETA_TRACING_DETAILED: '1',
      BETA_TRACING_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_SDK_DISABLED: 'false',
    });
  });

  it('round-trips Codex with a managed block', () => {
    mkdirSync(join(dir, '.codex'));
    writeFileSync(codexConfigPath(), 'model = "gpt-5"\n');

    expect(runAgentSetup('enable', ['codex'], opts).ok).toBe(true);
    const text = read(codexConfigPath());
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain(
      'exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/logs", protocol = "binary" } }',
    );
    expect(text).toContain('/v1/traces');
    expect(text).toContain('/v1/metrics');
    // Re-enabling replaces our block rather than adding a second [otel].
    runAgentSetup('enable', ['codex'], opts);
    expect(read(codexConfigPath()).match(/\[otel\]/g)).toHaveLength(1);
    expect(runAgentSetup('status', ['codex'], opts).lines[0]).toMatch(
      /^codex: enabled/,
    );

    runAgentSetup('disable', ['codex'], opts);
    expect(read(codexConfigPath())).toBe('model = "gpt-5"\n');
  });

  it('refuses to edit a Codex config that already configures otel', () => {
    mkdirSync(join(dir, '.codex'));
    const original = '[otel]\nexporter = "none"\n';
    writeFileSync(codexConfigPath(), original);
    const result = runAgentSetup('enable', ['codex'], opts);
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/refused/);
    expect(read(codexConfigPath())).toBe(original);
  });

  it('keeps an edited Codex block on disable', () => {
    runAgentSetup('enable', ['codex'], opts);
    writeFileSync(
      codexConfigPath(),
      read(codexConfigPath()).replace('/v1/logs', '/v1/custom'),
    );
    expect(runAgentSetup('status', ['codex'], opts).lines[0]).toMatch(
      /drifted/,
    );
    const out = runAgentSetup('disable', ['codex'], opts).lines.join('\n');
    expect(out).toContain('kept the managed block');
    expect(read(codexConfigPath())).toContain('/v1/custom');
  });
});

describe('repository correlation hook', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const hook = '"node" "/x/cli.js" agents hook';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autotel-repo-'));
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HOME = dir;
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const sessionStart = () =>
    JSON.parse(read(claudeSettingsPath())).hooks?.SessionStart;

  it('registers the SessionStart hook on enable and removes only it on disable', () => {
    mkdirSync(join(dir, '.claude'));
    const theirs = { hooks: [{ type: 'command', command: 'echo hi' }] };
    writeFileSync(
      claudeSettingsPath(),
      JSON.stringify({ hooks: { SessionStart: [theirs] } }),
    );
    runAgentSetup('enable', ['claude-code'], { ...opts, hookCommand: hook });
    expect(sessionStart()).toHaveLength(2);
    // Re-enabling replaces our entry rather than stacking a second one.
    runAgentSetup('enable', ['claude-code'], { ...opts, hookCommand: hook });
    expect(sessionStart()).toHaveLength(2);
    runAgentSetup('disable', ['claude-code'], opts);
    expect(sessionStart()).toEqual([theirs]);
  });

  it('adds no hook with --repository=off', () => {
    runAgentSetup('enable', ['claude-code'], {
      ...opts,
      repository: 'off',
      hookCommand: hook,
    });
    expect(sessionStart()).toBeUndefined();
  });

  it('resolves a worktree to its main checkout', () => {
    const main = join(dir, 'autotel');
    mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..');
    const wt = join(dir, 'wt', 'packages');
    mkdirSync(wt, { recursive: true });
    writeFileSync(
      join(dir, 'wt', '.git'),
      `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`,
    );
    expect(repositoryOf(wt)).toEqual({ name: 'autotel', path: main });
    expect(repositoryOf(join(main))).toEqual({ name: 'autotel', path: main });
  });

  it('sends the repository event, without the path in name mode', async () => {
    const posts: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      posts.push({ url, body: init.body });
      return new Response(null, { status: 200 });
    });
    runAgentSetup('enable', ['claude-code'], {
      ...opts,
      repository: 'name',
      hookCommand: hook,
    });
    await runRepositoryHook(
      JSON.stringify({
        session_id: 's-1',
        cwd: dir,
        hook_event_name: 'SessionStart',
      }),
    );
    expect(posts[0]?.url).toBe('http://127.0.0.1:4318/v1/logs');
    const attrs = JSON.parse(posts[0]!.body).resourceLogs[0].scopeLogs[0]
      .logRecords[0].attributes as { key: string }[];
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain('repository.name');
    expect(keys).toContain('session.id');
    expect(keys).not.toContain('repository.path');
  });
});

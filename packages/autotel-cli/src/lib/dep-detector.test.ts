import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectEnvKeys,
  detectBackend,
  detectLoggers,
  detectInProject,
  enumerateWorkspacePackages,
  envFilesRequireConsent,
} from './dep-detector';
import type { ProjectContext } from '../types/index';

function makeProject(packageRoot: string, packageJson: object): ProjectContext {
  return {
    cwd: packageRoot,
    packageRoot,
    packageJsonPath: path.join(packageRoot, 'package.json'),
    packageJson: packageJson as ProjectContext['packageJson'],
    packageManager: 'pnpm',
    lockfilePath: null,
    workspace: {
      isMonorepo: false,
      workspaceRoot: null,
      packageRoot,
      workspaceType: null,
    },
    hasTypeScript: true,
    isEsm: true,
  };
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-detect-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('detectLoggers', () => {
  it('returns Pino as primary when only pino is present', () => {
    const result = detectLoggers(new Map([['pino', {}]]));
    expect(result.primary).toBe('pino');
    expect(result.autoInstrument).toEqual([]);
  });

  it('prefers Pino as primary when both pino + winston present', () => {
    const result = detectLoggers(
      new Map([
        ['winston', {}],
        ['pino', {}],
      ])
    );
    expect(result.primary).toBe('pino');
    expect(result.autoInstrument).toEqual(['winston']);
  });

  it('falls back to winston when no pino present', () => {
    const result = detectLoggers(new Map([['winston', {}]]));
    expect(result.primary).toBe('winston');
    expect(result.autoInstrument).toEqual([]);
  });

  it('returns null when no logger is present', () => {
    const result = detectLoggers(new Map([['express', {}]]));
    expect(result.primary).toBeNull();
    expect(result.autoInstrument).toEqual([]);
  });
});

describe('collectEnvKeys', () => {
  it('reads .env.example without consent', () => {
    fs.writeFileSync(
      path.join(tmp, '.env.example'),
      '# comment\nDATADOG_API_KEY=\nFOO=bar\n'
    );
    const { keys, sources } = collectEnvKeys({
      packageRoot: tmp,
      envConsent: false,
    });
    expect([...keys]).toEqual(expect.arrayContaining(['DATADOG_API_KEY', 'FOO']));
    expect(sources).toContain('.env.example');
  });

  it('does NOT read .env without consent', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=abc\n');
    const { keys, sources } = collectEnvKeys({
      packageRoot: tmp,
      envConsent: false,
    });
    expect(keys.has('SECRET')).toBe(false);
    expect(sources).not.toContain('.env');
  });

  it('reads .env with consent', () => {
    fs.writeFileSync(path.join(tmp, '.env'), 'HONEYCOMB_API_KEY=abc\n');
    const { keys, sources } = collectEnvKeys({
      packageRoot: tmp,
      envConsent: true,
    });
    expect(keys.has('HONEYCOMB_API_KEY')).toBe(true);
    expect(sources).toContain('.env');
  });
});

describe('envFilesRequireConsent', () => {
  it('true when .env present', () => {
    fs.writeFileSync(path.join(tmp, '.env'), '');
    expect(envFilesRequireConsent(tmp)).toBe(true);
  });
  it('false when only .env.example present', () => {
    fs.writeFileSync(path.join(tmp, '.env.example'), '');
    expect(envFilesRequireConsent(tmp)).toBe(false);
  });
});

describe('detectBackend', () => {
  it('picks Datadog when DD_API_KEY present', () => {
    const result = detectBackend({
      envKeys: new Set(['DD_API_KEY']),
      packageRoot: tmp,
      deps: new Map(),
    });
    expect(result.slug).toBe('datadog');
    expect(result.source).toBe('env');
  });

  it('picks Honeycomb when HONEYCOMB_API_KEY present', () => {
    const result = detectBackend({
      envKeys: new Set(['HONEYCOMB_API_KEY']),
      packageRoot: tmp,
      deps: new Map(),
    });
    expect(result.slug).toBe('honeycomb');
  });

  it('picks otlp-http when OTEL_EXPORTER_OTLP_ENDPOINT present', () => {
    const result = detectBackend({
      envKeys: new Set(['OTEL_EXPORTER_OTLP_ENDPOINT']),
      packageRoot: tmp,
      deps: new Map(),
    });
    expect(result.slug).toBe('otlp-http');
  });

  it('falls back to local with source=default', () => {
    const result = detectBackend({
      envKeys: new Set(),
      packageRoot: tmp,
      deps: new Map(),
    });
    expect(result.slug).toBe('local');
    expect(result.source).toBe('default');
  });
});

describe('detectInProject', () => {
  it('detects Hono + Pino + PostHog + Sentry from package.json', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'demo',
        dependencies: {
          hono: '^4.0.0',
          pino: '^9.0.0',
          'posthog-node': '^4.0.0',
          '@sentry/node': '^8.0.0',
          express: '^4.18.0',
        },
      })
    );
    const project = makeProject(
      tmp,
      JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
    );

    const result = detectInProject({ project, envConsent: false });

    expect(result.presets).toEqual(
      expect.arrayContaining(['hono', 'posthog', 'sentry'])
    );
    expect(result.primaryLogger).toBe('pino');
    expect(result.autoInstrumentedDeps).toContain('express');
    expect(result.backend.slug).toBe('local');
    expect(result.backend.source).toBe('default');
  });

  it('detects cloudflare platform from wrangler.toml', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { hono: '^4' } })
    );
    fs.writeFileSync(path.join(tmp, 'wrangler.toml'), 'name = "demo"\n');
    const project = makeProject(
      tmp,
      JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
    );
    const result = detectInProject({ project, envConsent: false });
    expect(result.platform).toBe('cloudflare');
    expect(result.presets).toContain('cloudflare');
  });

  it('merges deps from workspace root when present', () => {
    const root = tmp;
    const sub = path.join(tmp, 'apps/api');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'root', dependencies: { pino: '^9' } })
    );
    fs.writeFileSync(
      path.join(sub, 'package.json'),
      JSON.stringify({ name: 'api', dependencies: { hono: '^4' } })
    );

    const project: ProjectContext = {
      ...makeProject(
        sub,
        JSON.parse(fs.readFileSync(path.join(sub, 'package.json'), 'utf8'))
      ),
      workspace: {
        isMonorepo: true,
        workspaceRoot: root,
        packageRoot: sub,
        workspaceType: 'npm',
      },
    };
    const result = detectInProject({ project, envConsent: false });
    expect(result.primaryLogger).toBe('pino');
    expect(result.presets).toContain('hono');
    const pinoEntry = result.packages.find((p) => p.name === 'pino');
    expect(pinoEntry?.resolution).toBe('workspace-root');
  });

  it('Datadog env var promotes backend to datadog', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo' })
    );
    fs.writeFileSync(path.join(tmp, '.env.example'), 'DD_API_KEY=\n');
    const project = makeProject(
      tmp,
      JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
    );
    const result = detectInProject({ project, envConsent: false });
    expect(result.backend.slug).toBe('datadog');
    expect(result.backend.source).toBe('env');
  });
});

describe('enumerateWorkspacePackages', () => {
  it('reads pnpm-workspace.yaml packages glob', () => {
    fs.writeFileSync(
      path.join(tmp, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n'
    );
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'packages/core'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'packages/core/package.json'), '{}');

    const found = enumerateWorkspacePackages(tmp);
    expect(found.map((p) => path.relative(tmp, p)).toSorted()).toEqual([
      'apps/api',
      'apps/web',
      'packages/core',
    ]);
  });

  it('reads npm/yarn workspaces from root package.json', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['apps/*'] })
    );
    fs.mkdirSync(path.join(tmp, 'apps/a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/a/package.json'), '{}');

    const found = enumerateWorkspacePackages(tmp);
    expect(found.map((p) => path.relative(tmp, p))).toEqual(['apps/a']);
  });

  it('dedupes when both pnpm-workspace.yaml and package.json declare overlap', () => {
    fs.writeFileSync(
      path.join(tmp, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n'
    );
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['apps/*'] })
    );
    fs.mkdirSync(path.join(tmp, 'apps/a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/a/package.json'), '{}');
    const found = enumerateWorkspacePackages(tmp);
    expect(found).toHaveLength(1);
  });
});

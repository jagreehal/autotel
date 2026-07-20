import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageJson, ProjectContext } from '../types/index';
import { readJsonSafe, fileExists, readFileSafe } from './fs';

/**
 * Detection layer for `autotel init`.
 *
 * Inputs (in order of consultation):
 *   1. Target package.json (deps + devDeps)
 *   2. Workspace root package.json (hoisted deps in npm/yarn workspaces)
 *   3. .env.example (always safe — committed file)
 *   4. .env / .env.local — ONLY when `envConsent: true` (gated by --scan-env
 *      or interactive prompt). Caller is responsible for obtaining consent.
 *   5. wrangler.toml / wrangler.jsonc — platform marker
 *
 * Output is a `DetectionResult` describing detected packages, preferred
 * logger, backend-with-source, and platform. The init command then builds
 * an `InitPlan` from this + the preset registry.
 */

export type LoggerKind = 'pino' | 'winston' | 'bunyan';

export type PresetSlug =
  // backends
  | 'datadog'
  | 'datadog-agent'
  | 'google-cloud'
  | 'honeycomb'
  | 'otlp-http'
  | 'otlp-grpc'
  | 'local'
  // subscribers
  | 'posthog'
  | 'mixpanel'
  | 'amplitude'
  | 'segment'
  | 'slack'
  | 'webhook'
  // plugins
  | 'mongoose'
  | 'drizzle'
  | 'sentry'
  | 'hono'
  | 'mcp'
  | 'tanstack'
  | 'nestjs'
  | 'sveltekit'
  | 'elysia'
  | 'nuxt'
  // platforms
  | 'aws-lambda'
  | 'cloudflare'
  | 'edge';

export interface DetectedPackage {
  /** npm package name */
  name: string;
  /** Version range from package.json (e.g. "^4.0.0") */
  version: string;
  /** Where it was found */
  resolution: 'target' | 'workspace-root';
}

export interface DetectedBackend {
  slug: PresetSlug;
  /** What told us. `default` = nothing detected, fell back. */
  source: 'env' | 'wrangler' | 'deps' | 'default';
  /** Optional human-readable detail (e.g. which env var). */
  detail?: string;
}

export interface DetectionResult {
  packages: DetectedPackage[];
  /** First-party autotel presets to wire. */
  presets: PresetSlug[];
  /** First-class logger (gets `init({ logger })`). Null if none. */
  primaryLogger: LoggerKind | null;
  /** Loggers that should appear in `autoInstrumentations`. */
  autoInstrumentLoggers: LoggerKind[];
  /** Auto-instrumentation deps covered by @opentelemetry/auto-instrumentations-node. */
  autoInstrumentedDeps: string[];
  backend: DetectedBackend;
  /** Platform preset to apply (cloudflare, aws-lambda, edge). */
  platform: PresetSlug | null;
}

/**
 * Mapping table: dep name -> preset slug (first-party autotel wrapper) or
 * null (covered by @opentelemetry/auto-instrumentations-node only).
 *
 * Loggers handled separately (see `detectLoggers`).
 */
const DEP_TO_PRESET: Record<string, PresetSlug | 'auto-instr'> = {
  // First-party autotel wrappers
  '@sentry/node': 'sentry',
  '@sentry/bun': 'sentry',
  hono: 'hono',
  '@modelcontextprotocol/sdk': 'mcp',
  '@tanstack/start': 'tanstack',
  '@tanstack/start-server': 'tanstack',
  '@tanstack/start-client': 'tanstack',
  '@nestjs/core': 'nestjs',
  '@sveltejs/kit': 'sveltekit',
  elysia: 'elysia',
  nuxt: 'nuxt',

  // Subscribers
  'posthog-node': 'posthog',
  '@posthog/node': 'posthog',
  mixpanel: 'mixpanel',
  '@amplitude/analytics-node': 'amplitude',
  '@segment/analytics-node': 'segment',
  '@slack/web-api': 'slack',
  '@slack/webhook': 'slack',

  // Plugins (existing presets)
  mongoose: 'mongoose',
  'drizzle-orm': 'drizzle',

  // Auto-instrumented (no first-party preset needed)
  express: 'auto-instr',
  fastify: 'auto-instr',
  next: 'auto-instr',
  pg: 'auto-instr',
  mysql: 'auto-instr',
  mysql2: 'auto-instr',
  redis: 'auto-instr',
  ioredis: 'auto-instr',
  '@aws-sdk/client-s3': 'auto-instr',
  graphql: 'auto-instr',
};

const LOGGER_DEPS: Record<string, LoggerKind> = {
  pino: 'pino',
  winston: 'winston',
  bunyan: 'bunyan',
};

/** Backends inferable from env-var keys (values not used — only key presence). */
const ENV_KEY_TO_BACKEND: { key: string; slug: PresetSlug }[] = [
  { key: 'DD_API_KEY', slug: 'datadog' },
  { key: 'DATADOG_API_KEY', slug: 'datadog' },
  { key: 'HONEYCOMB_API_KEY', slug: 'honeycomb' },
  { key: 'HONEYCOMB_WRITE_KEY', slug: 'honeycomb' },
  { key: 'GOOGLE_CLOUD_PROJECT', slug: 'google-cloud' },
  // OTEL endpoint is generic enough that we pick otlp-http
  { key: 'OTEL_EXPORTER_OTLP_ENDPOINT', slug: 'otlp-http' },
];

/** Merge two dep maps; target package wins on overlapping names. */
function mergeDeps(
  target: PackageJson,
  root: PackageJson | null
): Map<string, { version: string; resolution: 'target' | 'workspace-root' }> {
  const out = new Map<
    string,
    { version: string; resolution: 'target' | 'workspace-root' }
  >();

  if (root) {
    for (const [name, version] of Object.entries({
      ...root.dependencies,
      ...root.devDependencies,
    })) {
      out.set(name, { version, resolution: 'workspace-root' });
    }
  }

  for (const [name, version] of Object.entries({
    ...target.dependencies,
    ...target.devDependencies,
  })) {
    out.set(name, { version, resolution: 'target' });
  }

  return out;
}

/**
 * Detect loggers, resolving conflict per the design: Pino wins as first-class
 * (`init({ logger })`); Winston/Bunyan become auto-instrumentations.
 */
export function detectLoggers(deps: Map<string, unknown>): {
  primary: LoggerKind | null;
  autoInstrument: LoggerKind[];
} {
  const present: LoggerKind[] = [];
  for (const [name, kind] of Object.entries(LOGGER_DEPS)) {
    if (deps.has(name)) present.push(kind);
  }
  if (present.length === 0) return { primary: null, autoInstrument: [] };

  if (present.includes('pino')) {
    return {
      primary: 'pino',
      autoInstrument: present.filter((l) => l !== 'pino'),
    };
  }
  // No pino — pick the first non-pino logger as primary for code-gen; the
  // others still go through auto-instr.
  return {
    primary: present[0] ?? null,
    autoInstrument: present.slice(1),
  };
}

/**
 * Read env-var keys from .env-style files (KEY=value lines). Values are
 * not returned — only the set of keys present. Comment lines (#) skipped.
 */
function parseEnvKeys(content: string): Set<string> {
  const out = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key.length > 0) out.add(key);
  }
  return out;
}

/**
 * Collect env keys from .env.example (always) and .env/.env.local (only if
 * `envConsent` is true). Used for backend detection.
 */
export function collectEnvKeys(opts: {
  packageRoot: string;
  envConsent: boolean;
}): { keys: Set<string>; sources: string[] } {
  const keys = new Set<string>();
  const sources: string[] = [];

  const tryRead = (name: string, requiresConsent: boolean): void => {
    if (requiresConsent && !opts.envConsent) return;
    const p = path.join(opts.packageRoot, name);
    const content = readFileSafe(p);
    if (content === null) return;
    sources.push(name);
    for (const k of parseEnvKeys(content)) keys.add(k);
  };

  tryRead('.env.example', false);
  tryRead('.env.sample', false);
  tryRead('.env', true);
  tryRead('.env.local', true);

  return { keys, sources };
}

/**
 * Detect backend in priority order: env > wrangler > deps > default(local).
 */
export function detectBackend(opts: {
  envKeys: Set<string>;
  packageRoot: string;
  deps: Map<string, unknown>;
}): DetectedBackend {
  for (const { key, slug } of ENV_KEY_TO_BACKEND) {
    if (opts.envKeys.has(key)) {
      return { slug, source: 'env', detail: key };
    }
  }

  // wrangler.toml or wrangler.jsonc → cloudflare platform implies OTLP-style
  // export; we still want a *backend* though, so cloudflare detection only
  // sets the platform (see detectPlatform). Backend stays at default unless
  // env says otherwise.

  // Deps: dd-trace as a backend hint (rare, but explicit)
  if (opts.deps.has('dd-trace')) {
    return { slug: 'datadog', source: 'deps', detail: 'dd-trace' };
  }

  return { slug: 'local', source: 'default' };
}

export function detectPlatform(packageRoot: string): PresetSlug | null {
  if (
    fileExists(path.join(packageRoot, 'wrangler.toml')) ||
    fileExists(path.join(packageRoot, 'wrangler.jsonc')) ||
    fileExists(path.join(packageRoot, 'wrangler.json'))
  ) {
    return 'cloudflare';
  }
  // AWS Lambda + Edge are harder to detect from filesystem alone; skip for
  // v1 and rely on user override.
  return null;
}

/**
 * Top-level: build a DetectionResult for the given project context.
 */
export function detectInProject(opts: {
  project: ProjectContext;
  envConsent: boolean;
}): DetectionResult {
  const { project } = opts;

  // Read workspace-root package.json if different from target package
  let rootPkg: PackageJson | null = null;
  if (
    project.workspace.workspaceRoot !== null &&
    project.workspace.workspaceRoot !== project.packageRoot
  ) {
    rootPkg = readJsonSafe<PackageJson>(
      path.join(project.workspace.workspaceRoot, 'package.json')
    );
  }

  const deps = mergeDeps(project.packageJson, rootPkg);

  const detectedPackages: DetectedPackage[] = [];
  const presetSet = new Set<PresetSlug>();
  const autoInstrDeps: string[] = [];

  for (const [name, info] of deps.entries()) {
    const mapping = DEP_TO_PRESET[name];
    if (mapping === undefined && LOGGER_DEPS[name] === undefined) continue;

    detectedPackages.push({
      name,
      version: info.version,
      resolution: info.resolution,
    });

    if (mapping === 'auto-instr') {
      autoInstrDeps.push(name);
    } else if (mapping !== undefined) {
      presetSet.add(mapping);
    }
  }

  const loggers = detectLoggers(deps);

  // Detection of platform from filesystem markers
  const platform = detectPlatform(project.packageRoot);
  if (platform !== null) presetSet.add(platform);

  // Backend
  const { keys: envKeys } = collectEnvKeys({
    packageRoot: project.packageRoot,
    envConsent: opts.envConsent,
  });
  const backend = detectBackend({
    envKeys,
    packageRoot: project.packageRoot,
    deps,
  });

  return {
    packages: detectedPackages,
    presets: [...presetSet],
    primaryLogger: loggers.primary,
    autoInstrumentLoggers: loggers.autoInstrument,
    autoInstrumentedDeps: autoInstrDeps,
    backend,
    platform,
  };
}

/**
 * True if a .env or .env.local file exists at packageRoot (consent is needed
 * to read it). .env.example is committed and doesn't trigger this.
 */
export function envFilesRequireConsent(packageRoot: string): boolean {
  return (
    fileExists(path.join(packageRoot, '.env')) ||
    fileExists(path.join(packageRoot, '.env.local'))
  );
}

/**
 * Enumerate workspaces under a pnpm/yarn/npm workspace root. Returns the
 * absolute path of each package containing a package.json.
 */
export function enumerateWorkspacePackages(workspaceRoot: string): string[] {
  const results: string[] = [];

  // pnpm-workspace.yaml
  const pnpmFile = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  if (fileExists(pnpmFile)) {
    const content = readFileSafe(pnpmFile) ?? '';
    const patterns = parsePnpmWorkspacePatterns(content);
    for (const pattern of patterns) {
      expandPattern(workspaceRoot, pattern, results);
    }
  }

  // package.json workspaces (npm/yarn)
  const rootPkg = readJsonSafe<PackageJson>(
    path.join(workspaceRoot, 'package.json')
  );
  if (rootPkg?.workspaces) {
    const patterns = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces.packages;
    for (const pattern of patterns) {
      expandPattern(workspaceRoot, pattern, results);
    }
  }

  // Dedupe (in case both pnpm-workspace.yaml and package.json declare the same)
  return [...new Set(results)];
}

function parsePnpmWorkspacePatterns(yaml: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (line.trim().length === 0) continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s*-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line);
      if (m && m[1] !== undefined) out.push(m[1]);
      else if (!/^\s/.test(line)) break;
    }
  }
  return out;
}

function expandPattern(
  root: string,
  pattern: string,
  results: string[]
): void {
  // Support simple "apps/*" and exact-path patterns. Skip negations.
  if (pattern.startsWith('!')) return;

  if (pattern.endsWith('/*')) {
    const parent = path.join(root, pattern.slice(0, -2));
    if (!fs.existsSync(parent)) return;
    for (const entry of fs.readdirSync(parent)) {
      const full = path.join(parent, entry);
      const pkgJson = path.join(full, 'package.json');
      if (fileExists(pkgJson)) results.push(full);
    }
    return;
  }

  if (pattern.endsWith('/**')) {
    const parent = path.join(root, pattern.slice(0, -3));
    walkForPackageJson(parent, results, 3);
    return;
  }

  // Exact path
  const full = path.join(root, pattern);
  if (fileExists(path.join(full, 'package.json'))) results.push(full);
}

function walkForPackageJson(
  dir: string,
  out: string[],
  maxDepth: number
): void {
  if (maxDepth < 0 || !fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (fileExists(path.join(full, 'package.json'))) {
      out.push(full);
    } else {
      walkForPackageJson(full, out, maxDepth - 1);
    }
  }
}

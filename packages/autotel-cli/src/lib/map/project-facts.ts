import * as path from 'node:path';
import { globSync } from 'glob';
import type { PackageJson } from '../../types/index';
import { fileExists, readFileSafe, readJsonSafe } from '../fs';
import { findInstrumentationFile } from '../config-detector';
import { buildFileFacts, createParser, usesAutotelApi } from './facts';

/** What the project has already adopted — the gate for every opportunity rule. */
export interface ProjectFacts {
  name: string;
  /** Every dependency name, prod and dev. */
  deps: ReadonlySet<string>;
  hasAutotel: boolean;
  /**
   * A framework integration creates the request span for every request, so a
   * handler that never calls `trace()` is still on the trace — it just carries
   * nothing but method, path, and status.
   */
  ambientTracing: boolean;
  /** `init()` configures `attributeRedactor`. */
  hasRedaction: boolean;
  /** Path of the instrumentation file, relative to the project root. */
  instrumentationFile: string | null;
  /** An LLM SDK is installed, so GenAI suggestions are worth making. */
  hasLlmDependency: boolean;
  hasZod: boolean;
  /** The project already records security/audit signals somewhere. */
  hasAuditUsage: boolean;
  hasErrorCatalog: boolean;
  repeatedErrors: ReadonlyMap<
    string,
    { label: string; files: readonly string[] }
  >;
}

const LLM_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  'ai-sdk-ollama',
  'ollama',
  '@google/generative-ai',
  '@mistralai/mistralai',
  'cohere-ai',
  'langchain',
  '@langchain/core',
];

const RUNTIME_AUTOTEL_PACKAGES = [
  'autotel',
  'autotel-edge',
  'autotel-cloudflare',
  'autotel-nuxt',
  'autotel-tanstack',
  'autotel-hono',
  'autotel-adapters',
];

/**
 * Files where a framework integration is wired up.
 *
 * Kept to a fixed list rather than a glob: this answers "did anyone install the
 * middleware", and the answer is always in the app's entry file or its hooks.
 */
const WIRING_FILES = [
  'src/index.ts',
  'src/app.ts',
  'src/server.ts',
  'src/main.ts',
  'index.ts',
  'app.ts',
  'server.ts',
  'middleware.ts',
  'src/middleware.ts',
  'src/hooks.server.ts',
  'hooks.server.ts',
  'nuxt.config.ts',
  'src/router.tsx',
  'app/router.tsx',
];

/** Autotel framework integrations that create a request span when called. */
const AMBIENT_APIS = ['autotelMiddleware', 'autotelHandle'];

function hasAmbientTracing(
  projectRoot: string,
  instrumentationPath: string | null,
): boolean {
  const parse = createParser();
  const candidates = new Set(
    [
      instrumentationPath,
      ...WIRING_FILES.map((file) => path.join(projectRoot, file)),
    ].filter((file): file is string => file !== null && fileExists(file)),
  );

  for (const file of candidates) {
    const source = parse(file);
    if (source && usesAutotelApi(buildFileFacts(source), AMBIENT_APIS)) {
      return true;
    }
  }
  return false;
}

/** What projectSource() answers with. */
interface ProjectSourceResult {
  text: string;
  repeatedErrors: ProjectFacts['repeatedErrors'];
}

function projectSource(projectRoot: string): ProjectSourceResult {
  const files = globSync(
    '{src,app,server,routes,pages}/**/*.{ts,tsx,js,jsx,mts,mjs}',
    {
      cwd: projectRoot,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.*',
        '**/*.spec.*',
      ],
    },
  );
  const occurrences = new Map<string, { label: string; files: Set<string> }>();
  const chunks: string[] = [];
  const call = /createStructuredError\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const file of files) {
    const source = readFileSafe(file) ?? '';
    chunks.push(source);
    for (const match of source.matchAll(call)) {
      const body = match[1] ?? '';
      const message = /\bmessage\s*:\s*(['"`])([\s\S]*?)\1/.exec(body)?.[2];
      const status = /\bstatus\s*:\s*(\d+)/.exec(body)?.[1];
      if (!message || !status) continue;
      const signature = `${status}|${message}`;
      const entry = occurrences.get(signature) ?? {
        label: message,
        files: new Set<string>(),
      };
      entry.files.add(
        path.relative(projectRoot, file).split(path.sep).join('/'),
      );
      occurrences.set(signature, entry);
    }
  }
  return {
    text: chunks.join('\n'),
    repeatedErrors: new Map(
      [...occurrences]
        .filter(([, entry]) => entry.files.size > 1)
        .map(([signature, entry]) => [
          signature,
          { label: entry.label, files: [...entry.files].toSorted() },
        ]),
    ),
  };
}

function collectDeps(pkg: PackageJson | null): Set<string> {
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
}

export function collectProjectFacts(projectRoot: string): ProjectFacts {
  const pkg = readJsonSafe<PackageJson>(path.join(projectRoot, 'package.json'));
  const deps = collectDeps(pkg);

  const instrumentation = findInstrumentationFile(projectRoot);
  const instrumentationText = instrumentation
    ? (readFileSafe(instrumentation.path) ?? '')
    : '';

  const wiringText = WIRING_FILES.map((candidate) =>
    fileExists(path.join(projectRoot, candidate))
      ? (readFileSafe(path.join(projectRoot, candidate)) ?? '')
      : '',
  ).join('\n');

  const ambientText = `${instrumentationText}\n${wiringText}`;
  const source = projectSource(projectRoot);
  const projectSignalText = `${ambientText}\n${source.text}`;

  return {
    name: pkg?.name ?? path.basename(projectRoot),
    deps,
    hasAutotel: RUNTIME_AUTOTEL_PACKAGES.some((name) => deps.has(name)),
    ambientTracing:
      deps.has('autotel-nuxt') ||
      hasAmbientTracing(projectRoot, instrumentation?.path ?? null),
    hasRedaction: instrumentationText.includes('attributeRedactor'),
    instrumentationFile: instrumentation
      ? path
          .relative(projectRoot, instrumentation.path)
          .split(path.sep)
          .join('/')
      : null,
    hasLlmDependency: LLM_PACKAGES.some((name) => deps.has(name)),
    hasZod: deps.has('zod'),
    hasAuditUsage:
      deps.has('autotel-audit') &&
      /securityEvent|withSecurity|withAudit|defineAuditCatalog/.test(
        projectSignalText,
      ),
    hasErrorCatalog: projectSignalText.includes('defineErrorCatalog'),
    repeatedErrors: source.repeatedErrors,
  };
}

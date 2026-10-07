/**
 * Auto-instrumentation loading.
 *
 * `@opentelemetry/auto-instrumentations-node` pulls in forty-odd packages, so
 * it is an optional peer dependency loaded on demand — and only when the config
 * asks for it. This module also reconciles the automatic set against whatever
 * instrumentations were passed by hand, so the two never register twice for the
 * same library.
 */

import type { AutotelSdkOptions } from './sdk';
import { requireModule } from './node-require';
import { asFunction, readProperty } from './values';

/**
 * Extract instrumentation class names from instrumentation instances
 * Used to detect duplicates between manual and auto instrumentations
 */
export function getInstrumentationNames(
  instrumentations: AutotelSdkOptions['instrumentations'],
): Set<string> {
  const names = new Set<string>();

  if (!instrumentations) return names;

  for (const instrumentation of instrumentations) {
    const className = asFunction(
      readProperty(instrumentation, 'constructor'),
    )?.name;
    if (className) names.add(className);
  }

  return names;
}

/**
 * Map common instrumentation class names to their package names
 * Used to disable auto-instrumentations when user provides manual configs
 */
const INSTRUMENTATION_CLASS_TO_PACKAGE = new Map<string, string>(
  Object.entries({
    HttpInstrumentation: '@opentelemetry/instrumentation-http',
    HttpsInstrumentation: '@opentelemetry/instrumentation-http',
    ExpressInstrumentation: '@opentelemetry/instrumentation-express',
    FastifyInstrumentation: '@opentelemetry/instrumentation-fastify',
    MongoDBInstrumentation: '@opentelemetry/instrumentation-mongodb',
    MongooseInstrumentation: '@opentelemetry/instrumentation-mongoose',
    PrismaInstrumentation: '@opentelemetry/instrumentation-prisma',
    PinoInstrumentation: '@opentelemetry/instrumentation-pino',
    WinstonInstrumentation: '@opentelemetry/instrumentation-winston',
    RedisInstrumentation: '@opentelemetry/instrumentation-redis',
    GraphQLInstrumentation: '@opentelemetry/instrumentation-graphql',
    GrpcInstrumentation: '@opentelemetry/instrumentation-grpc',
    IORedisInstrumentation: '@opentelemetry/instrumentation-ioredis',
    KnexInstrumentation: '@opentelemetry/instrumentation-knex',
    NestJsInstrumentation: '@opentelemetry/instrumentation-nestjs-core',
    PgInstrumentation: '@opentelemetry/instrumentation-pg',
    MySQLInstrumentation: '@opentelemetry/instrumentation-mysql',
    MySQL2Instrumentation: '@opentelemetry/instrumentation-mysql2',
  }),
);

/**
 * Per-package config, as `getNodeAutoInstrumentations` takes it: `enabled`
 * plus whatever else that instrumentation accepts, which it forwards straight
 * to the constructor (`ignoreLayersType` for express, say).
 */
export type InstrumentationOptions = { enabled?: boolean } & Record<
  string,
  unknown
>;

/** Per-package switches, keyed by full package name. */
export interface InstrumentationSwitches {
  [packageName: string]: InstrumentationOptions;
}

/**
 * What autotel configures when the caller has not said otherwise.
 *
 * `instrumentation-express` opens a span per layer and runs the layer under it,
 * so whatever is active inside a middleware is that layer's span - one that
 * ends the moment `next()` fires. Request-wide attributes set there would land
 * on `middleware - anonymous` rather than on the request span every backend
 * shows as the resource. Ignoring the two leaf layer types puts them back on
 * the request span and drops a pile of noise spans with them; the route rename
 * (`GET /users/:id`) survives, because `rpcMetadata.route` is assigned before
 * the ignore check.
 *
 * Pass your own `ignoreLayersType` - `[]` for the upstream behaviour - to
 * override it, or `ignoreLayers` to silence only the noisy paths.
 */
const AUTOTEL_DEFAULTS: InstrumentationSwitches = {
  '@opentelemetry/instrumentation-express': {
    ignoreLayersType: ['middleware', 'request_handler'],
  },
};

/** Apply {@link AUTOTEL_DEFAULTS} under whatever the caller already chose. */
function withAutotelDefaults(
  config: InstrumentationSwitches,
): InstrumentationSwitches {
  const merged: InstrumentationSwitches = { ...config };
  for (const [packageName, defaults] of Object.entries(AUTOTEL_DEFAULTS)) {
    const options = merged[packageName];
    // Nothing to configure on an instrumentation that is not loading.
    if (options?.enabled === false) continue;
    merged[packageName] = { ...defaults, ...options };
  }
  return merged;
}

/**
 * `express` and `@opentelemetry/instrumentation-express` name the same thing.
 * `getNodeAutoInstrumentations` only answers to the full name - it
 * `diag.error`s anything else and ignores the config - so the short form every
 * autotel example uses has to be expanded before it gets there.
 */
function toPackageName(name: string): string {
  return name.startsWith('@opentelemetry/instrumentation-')
    ? name
    : `@opentelemetry/instrumentation-${name}`;
}

/**
 * The `getNodeAutoInstrumentations` signature.
 * @internal Named so tests can inject a loader in its place.
 */
export type AutoInstrumentationsLoader = (
  config?: InstrumentationSwitches,
) => AutotelSdkOptions['instrumentations'];

/**
 * Whether the app's entry runs as ESM: its extension when it has an explicit
 * one (`.mjs`/`.cjs`, and `.mts`/`.cts` under tsx), else the cwd
 * package.json's `type`.
 */
export function isESMMode(entry: string = process.argv[1] ?? ''): boolean {
  if (/\.c[jt]s$/.test(entry)) return false;
  if (/\.m[jt]s$/.test(entry)) return true;
  try {
    const fs = requireModule<typeof import('node:fs')>('node:fs');
    const pkg = JSON.parse(
      fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'),
    );
    return pkg.type === 'module';
  } catch {
    return false;
  }
}

/** Set by `autotel/register` so `init()` can tell the ESM hook is in place. */
export const REGISTER_FLAG = Symbol.for('autotel.register');

/**
 * Whether the OTel ESM loader hook is registered: by `autotel/register`, or
 * by pointing node at a `hook.mjs` directly.
 */
export function isEsmHookLoaded(
  flags: string = `${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS ?? ''}`,
): boolean {
  return (
    (globalThis as Record<symbol, unknown>)[REGISTER_FLAG] === true ||
    flags.includes('hook.mjs')
  );
}

const LOGGER_PACKAGES = ['pino', 'winston', 'bunyan'];

function loadedModulePaths(): string[] {
  try {
    const { createRequire } =
      requireModule<typeof import('node:module')>('node:module');
    // ESM links CJS deps into the cache before any module runs; only count
    // ones that have actually executed.
    return Object.entries(createRequire(`${process.cwd()}/`).cache)
      .filter(([, mod]) => mod?.loaded)
      .map(([path]) => path);
  } catch {
    return [];
  }
}

/**
 * Names in the array form that loaded nothing: a typo, or a library
 * auto-instrumentations-node has no instrumentation for (`fastify`, `next`).
 * Upstream only reports these through `diag`, which is silent by default.
 * Names a manual instrumentation replaced are not missing.
 */
export function missingInstrumentations(
  names: string[],
  loaded: Array<{ instrumentationName: string }>,
  manualInstrumentationNames: Set<string> = new Set(),
): string[] {
  const loadedNames = new Set(loaded.map((i) => i.instrumentationName));
  const replaced = new Set(
    [...manualInstrumentationNames].map((className) =>
      INSTRUMENTATION_CLASS_TO_PACKAGE.get(className),
    ),
  );
  return names.filter((name) => {
    const packageName = toPackageName(name);
    return !loadedNames.has(packageName) && !replaced.has(packageName);
  });
}

/**
 * Logger packages the config instruments that were already loaded when
 * `init()` ran. Instrumentations patch a package as it loads, so these never
 * get trace context: the logger module was imported before `init()`.
 */
export function loggersLoadedBeforeInit(
  integrations: string[] | boolean | InstrumentationSwitches,
  loadedPaths: string[] = loadedModulePaths(),
): string[] {
  if (integrations === false) return [];
  const requested =
    integrations === true
      ? LOGGER_PACKAGES
      : Array.isArray(integrations)
        ? integrations
        : Object.entries(integrations)
            .filter(([, options]) => options.enabled !== false)
            .map(([name]) => name);
  const wanted = new Set(requested.map((name) => toPackageName(name)));
  const paths = loadedPaths.map((path) => path.replaceAll('\\', '/'));
  return LOGGER_PACKAGES.filter(
    (name) =>
      wanted.has(toPackageName(name)) &&
      paths.some((path) => path.includes(`/node_modules/${name}/`)),
  );
}

/**
 * Lazy-load auto-instrumentations (optional peer dependency)
 * Only loads when integrations config is truthy, avoiding ~40+ package imports at startup.
 */
function loadNodeAutoInstrumentations(): AutoInstrumentationsLoader {
  try {
    const mod = requireModule<{
      getNodeAutoInstrumentations: AutoInstrumentationsLoader;
    }>('@opentelemetry/auto-instrumentations-node');
    return mod.getNodeAutoInstrumentations;
  } catch {
    const isESM = isESMMode();
    const baseMessage = '@opentelemetry/auto-instrumentations-node not found.';

    if (isESM) {
      throw new Error(
        `${baseMessage}\n\n` +
          'ESM Setup Required:\n' +
          '1. Install as a direct dependency: pnpm add @opentelemetry/auto-instrumentations-node\n' +
          '2. Create instrumentation.mjs with:\n' +
          "   import 'autotel/register';  // MUST be first!\n" +
          "   import { init } from 'autotel';\n" +
          "   import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';\n" +
          '   init({ service: "my-app", instrumentations: getNodeAutoInstrumentations() });\n' +
          '3. Run with: tsx --import ./instrumentation.mjs src/index.ts\n\n' +
          'See: https://github.com/jagreehal/autotel#esm-setup',
      );
    }

    throw new Error(
      `${baseMessage} Install it: pnpm add @opentelemetry/auto-instrumentations-node`,
    );
  }
}

/**
 * Injectable loader for testing. Set to override the default loader.
 * @internal
 */
let _autoInstrumentationsLoader: (() => AutoInstrumentationsLoader) | null =
  null;

/**
 * @internal Set custom loader (for testing)
 */
export function _setAutoInstrumentationsLoader(
  loader: (() => AutoInstrumentationsLoader) | null,
): void {
  _autoInstrumentationsLoader = loader;
}

/**
 * @internal Reset loader to default (for testing cleanup)
 */
export function _resetAutoInstrumentationsLoader(): void {
  _autoInstrumentationsLoader = null;
}

const HTTP_PACKAGE = '@opentelemetry/instrumentation-http';

/** The part of `http.IncomingMessage` the ignore hook reads. */
type IncomingRequest = { socket?: { localPort?: number } };

/**
 * Get auto-instrumentations based on simple integration names
 * Excludes instrumentations that are manually provided to avoid conflicts
 */
export function getAutoInstrumentations(
  integrations: string[] | boolean | InstrumentationSwitches,
  manualInstrumentationNames: Set<string> = new Set(),
  ignoredServerPorts: number[] = [],
): AutotelSdkOptions['instrumentations'] {
  if (integrations === false) {
    return [];
  }

  // Use injected loader if set (for testing), otherwise lazy-load
  const getNodeAutoInstrumentations = _autoInstrumentationsLoader
    ? _autoInstrumentationsLoader()
    : loadNodeAutoInstrumentations();

  // Build exclusion config for manual instrumentations
  const exclusionConfig: InstrumentationSwitches = {};
  for (const className of manualInstrumentationNames) {
    const packageName = INSTRUMENTATION_CLASS_TO_PACKAGE.get(className);
    if (packageName) {
      exclusionConfig[packageName] = { enabled: false };
    }
  }

  const config: InstrumentationSwitches = { ...exclusionConfig };

  const requested: Array<[string, InstrumentationOptions]> =
    integrations === true
      ? []
      : Array.isArray(integrations)
        ? integrations.map((name) => [name, { enabled: true }])
        : Object.entries(integrations);

  for (const [name, options] of requested) {
    const packageName = toPackageName(name);
    // A manual instrumentation for the same package takes precedence.
    if (packageName in exclusionConfig) continue;
    config[packageName] = options;
  }

  // Requests to these ports (the embedded devtools server) are telemetry
  // about telemetry: each OTLP export and UI poll would become a root span,
  // a canonical log line, and another export.
  const http = config[HTTP_PACKAGE] ?? {};
  if (ignoredServerPorts.length > 0 && http.enabled !== false) {
    const userHook = http.ignoreIncomingRequestHook as
      ((request: IncomingRequest) => boolean) | undefined;
    config[HTTP_PACKAGE] = {
      ...http,
      ignoreIncomingRequestHook: (request: IncomingRequest) =>
        ignoredServerPorts.includes(request.socket?.localPort ?? -1) ||
        (userHook?.(request) ?? false),
    };
  }

  const resolved = withAutotelDefaults(config);
  if (!Array.isArray(integrations)) {
    return getNodeAutoInstrumentations(resolved);
  }
  // The array is an allowlist. getNodeAutoInstrumentations loads everything
  // it isn't told `enabled: false` about and exports no list of names, so
  // every name not listed reads as disabled.
  const listed = new Set(
    Object.keys(config).filter((name) => config[name]?.enabled === true),
  );
  return getNodeAutoInstrumentations(
    new Proxy(resolved, {
      get: (target, name) =>
        typeof name === 'string' && listed.has(name)
          ? target[name]
          : { enabled: false },
    }),
  );
}

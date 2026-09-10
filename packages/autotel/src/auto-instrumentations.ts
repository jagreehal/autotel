/**
 * Auto-instrumentation loading.
 *
 * `@opentelemetry/auto-instrumentations-node` pulls in forty-odd packages, so
 * it is an optional peer dependency loaded on demand — and only when the config
 * asks for it. This module also reconciles the automatic set against whatever
 * instrumentations were passed by hand, so the two never register twice for the
 * same library.
 */

import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { requireModule } from './node-require';
import { asFunction, readProperty } from './values';

/**
 * Extract instrumentation class names from instrumentation instances
 * Used to detect duplicates between manual and auto instrumentations
 */
export function getInstrumentationNames(
  instrumentations: NodeSDKConfiguration['instrumentations'],
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
) => NodeSDKConfiguration['instrumentations'];

/**
 * Detect if we're running in ESM mode
 */
export function isESMMode(): boolean {
  // Check if we're in an ESM context by looking for common ESM indicators
  try {
    // In ESM, module.exports doesn't exist in the global scope the same way
    // Also check if the package.json type is "module"
    const fs = requireModule<typeof import('node:fs')>('node:fs');
    try {
      const pkg = JSON.parse(
        fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'),
      );
      return pkg.type === 'module';
    } catch {
      return false;
    }
  } catch {
    return false;
  }
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

/**
 * Get auto-instrumentations based on simple integration names
 * Excludes instrumentations that are manually provided to avoid conflicts
 */
export function getAutoInstrumentations(
  integrations: string[] | boolean | InstrumentationSwitches,
  manualInstrumentationNames: Set<string> = new Set(),
): NodeSDKConfiguration['instrumentations'] {
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

  return getNodeAutoInstrumentations(withAutotelDefaults(config));
}

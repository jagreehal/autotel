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
    if (instrumentation && typeof instrumentation === 'object') {
      names.add(instrumentation.constructor.name);
    }
  }

  return names;
}

/**
 * Map common instrumentation class names to their package names
 * Used to disable auto-instrumentations when user provides manual configs
 */
const INSTRUMENTATION_CLASS_TO_PACKAGE: Record<string, string> = {
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
};

/**
 * Type for the auto-instrumentations loader function
 * @internal Used for testing injection
 */
export type AutoInstrumentationsLoader = (
  config?: Record<string, { enabled?: boolean }>,
) => unknown[];

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
  integrations: string[] | boolean | Record<string, { enabled?: boolean }>,
  manualInstrumentationNames: Set<string> = new Set(),
): unknown[] {
  if (integrations === false) {
    return [];
  }

  // Use injected loader if set (for testing), otherwise lazy-load
  const getNodeAutoInstrumentations = _autoInstrumentationsLoader
    ? _autoInstrumentationsLoader()
    : loadNodeAutoInstrumentations();

  // Build exclusion config for manual instrumentations
  const exclusionConfig: Record<string, { enabled: boolean }> = {};
  for (const className of manualInstrumentationNames) {
    const packageName = INSTRUMENTATION_CLASS_TO_PACKAGE[className];
    if (packageName) {
      exclusionConfig[packageName] = { enabled: false };
    }
  }

  if (integrations === true) {
    // If exclusions exist, pass them to getNodeAutoInstrumentations
    if (Object.keys(exclusionConfig).length > 0) {
      return getNodeAutoInstrumentations(exclusionConfig);
    }
    return getNodeAutoInstrumentations();
  }

  if (Array.isArray(integrations)) {
    const config: Record<string, { enabled: boolean }> = { ...exclusionConfig };
    for (const name of integrations) {
      const packageName = `@opentelemetry/instrumentation-${name}`;
      // Don't override exclusions
      if (!exclusionConfig[packageName]) {
        config[packageName] = { enabled: true };
      }
    }
    return getNodeAutoInstrumentations(config);
  }

  const config: Record<string, { enabled?: boolean }> = {
    ...exclusionConfig,
    ...integrations,
  };

  // Override any integrations that conflict with manual instrumentations
  for (const packageName of Object.keys(exclusionConfig)) {
    const integrationsKey = Object.keys(integrations).find((key) =>
      packageName.includes(key),
    );
    if (integrationsKey) {
      // Manual instrumentation takes precedence
      config[packageName] = { enabled: false };
    }
  }

  return getNodeAutoInstrumentations(config);
}

/**
 * Autotel Plugins - OpenTelemetry instrumentation for libraries without official support
 *
 * This package provides instrumentation for libraries that don't have official OpenTelemetry support
 * OR where the official support is fundamentally broken.
 *
 * Currently supported:
 * - Drizzle ORM (no official instrumentation available)
 * - Mongoose (official package broken in ESM+tsx - see mongoose/index.ts for details)
 *
 * Philosophy:
 * Only include plugins for libraries that either:
 * 1. Have NO official instrumentation (e.g., Drizzle ORM)
 * 2. Have BROKEN official instrumentation (e.g., Mongoose in ESM+tsx)
 * 3. Add SIGNIFICANT value beyond official packages
 *
 * For databases/ORMs with working official instrumentation, use those directly with the --import pattern:
 * - MongoDB: @opentelemetry/instrumentation-mongodb
 * - PostgreSQL: @opentelemetry/instrumentation-pg
 * - MySQL: @opentelemetry/instrumentation-mysql2
 * - Redis: @opentelemetry/instrumentation-redis
 *
 * See: https://github.com/open-telemetry/opentelemetry-js-contrib
 *
 * @example
 * ```typescript
 * // Drizzle manual instrumentation
 * import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
 * import { drizzle } from 'drizzle-orm/node-postgres';
 *
 * const db = instrumentDrizzleClient(drizzle(pool));
 * ```
 *
 * @example
 * ```typescript
 * // Mongoose runtime patching (works in ESM+tsx)
 * import mongoose from 'mongoose';
 * import { instrumentMongoose } from 'autotel-plugins/mongoose';
 *
 * instrumentMongoose(mongoose, { dbName: 'myapp' });
 * ```
 *
 * @packageDocumentation
 */

// Re-export common semantic conventions
export {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_DB_NAME,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from './common/constants';

// Re-export Drizzle plugin
export {
  instrumentDrizzle,
  instrumentDrizzleClient,
  type InstrumentDrizzleConfig,
} from './drizzle';

// Re-export Mongoose plugin
export {
  instrumentMongoose,
  MongooseInstrumentation,
  type MongooseInstrumentationConfig,
} from './mongoose';

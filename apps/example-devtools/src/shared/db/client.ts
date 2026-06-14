import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { instrumentDrizzleClient } from 'autotel-drizzle';
import * as schema from './schema';

export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL || 'file:./drizzle/dev.db';
}

export function createDb() {
  const client = createClient({
    url: resolveDatabaseUrl(),
  });

  return instrumentDrizzleClient(drizzle({ client, schema }), {
    dbSystem: 'sqlite',
    dbName: 'devtools-showcase',
  });
}

export { schema };

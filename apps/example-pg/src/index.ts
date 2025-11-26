/**
 * Postgres + Autotel (with separate instrumentation file)
 *
 * Run with: tsx --import ./src/instrumentation.mjs src/index-with-instrumentation.ts
 *
 */

import 'dotenv/config';
import { shutdown, trace } from 'autotel';
import pg from 'pg';

console.log('🚀 Starting Postgres POC with separate instrumentation file');

const connectionString =
  process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/postgres';
const client = new pg.Client({ connectionString });
let isConnected = false;

const runScenario = trace((ctx) => async () => {
  ctx.setAttribute('db.system', 'postgresql');
  ctx.setAttribute('scenario', 'pg-demo');

  console.log('\n📡 Connecting to Postgres...');
  await client.connect();
  console.log('✅ Connected to Postgres');
  isConnected = true;

  console.log('\n🔍 Executing query: SELECT NOW()');
  const result1 = await client.query('SELECT NOW()');
  console.log('✅ Query result:', result1.rows[0]);

  console.log('\n🔍 Executing parameterized query');
  const result2 = await client.query('SELECT $1::text as message', [
    'Hello from autotel-plugins!',
  ]);
  console.log('✅ Query result:', result2.rows[0]);
});

try {
  await runScenario();
  console.log('\n📤 Flushing spans...');
  await shutdown();

  console.log('📊 Check output above for spans');
  console.log(
    'Expected: pg.connect and pg.query spans with db.system=postgresql',
  );
} catch (error) {
  console.error('❌ Error:', error);
} finally {
  if (isConnected) {
    await client.end();
  }
  console.log('\n👋 Disconnected from Postgres');
  process.exit(0);
}

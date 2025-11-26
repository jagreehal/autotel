require('dotenv/config');
const { init, shutdown } = require('autotel');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

console.log('🚀 Starting CJS Postgres instrumentation test');
console.log('📦 Using regular require() - no dynamic imports!');

// Initialize BEFORE requiring pg
init({
  service: 'pg-cjs-test',
  debug: true,
  instrumentations: [
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
    }),
  ],
});

console.log('✅ Autotel initialized');

// NOW require pg AFTER init - should work because require() isn't hoisted!
console.log('\n📦 Requiring pg module AFTER init...');
const pg = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/postgres';
  const client = new pg.Client({ connectionString });

  try {
    console.log('\n📡 Connecting to Postgres...');
    await client.connect();
    console.log('✅ Connected');

    console.log('\n🔍 Executing test query...');
    const result = await client.query('SELECT NOW()');
    console.log('✅ Query result:', result.rows[0]);

    console.log('\n📤 Flushing spans...');
    await shutdown();

    console.log('\n🎉 CJS Test Complete!');
    console.log('📊 Check output above for spans');
    console.log('Expected: pg.connect and pg.query spans');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
    console.log('\n👋 Disconnected');
    process.exit(0);
  }
}

main();

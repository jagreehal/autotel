/**
 * Continuous mode — keeps generating traces so you can explore otel-tui live.
 *
 * Usage:
 *   1. Start otel-tui:  otel-tui
 *   2. Run this:         pnpm start:loop
 *   3. Watch traces stream in
 *   4. Ctrl+C to stop
 */

import { trace, span, shutdown, flush } from 'autotel';
import pino from 'pino';

const logger = pino({
  name: 'otel-tui-demo',
  level: 'debug',
});

const routes = ['/api/orders', '/api/users', '/api/products', '/api/health'] as const;
const methods = ['GET', 'POST', 'GET', 'GET'] as const;

async function apiRequest() {
  return trace('api.request', async (ctx) => {
    const idx = Math.floor(Math.random() * routes.length);
    const route = routes[idx]!;
    const method = methods[idx]!;
    ctx.setAttribute('http.method', method);
    ctx.setAttribute('http.route', route);
    logger.info({ method, route }, 'incoming request');

    await span({ name: 'auth.verify' }, async () => {
      logger.debug('verifying auth token');
      await delay(5 + jitter(10));
      logger.debug({ valid: true }, 'token verified');
    });

    await span({ name: 'handler.execute', attributes: { 'http.route': route } }, async (hCtx) => {
      logger.info({ route }, 'executing handler');

      // DB query
      await span({ name: 'db.query' }, async (dbCtx) => {
        const table = route.replace('/api/', '');
        dbCtx.setAttribute('db.system', 'postgresql');
        dbCtx.setAttribute('db.statement', `SELECT * FROM ${table} LIMIT 50`);
        logger.debug({ table }, 'executing database query');
        await delay(20 + jitter(40));

        if (Math.random() > 0.9) {
          const err = new Error('connection timeout');
          dbCtx.recordException(err);
          dbCtx.setStatus({ code: 2, message: 'db timeout' });
          logger.error({ table, err }, 'database query failed');
          throw err;
        }

        logger.debug({ table, rows: Math.floor(Math.random() * 50) }, 'query complete');
      });

      // Cache write
      await span({ name: 'cache.set' }, async (cacheCtx) => {
        cacheCtx.setAttribute('cache.system', 'redis');
        logger.debug({ key: `cache:${route}` }, 'writing to cache');
        await delay(3 + jitter(5));
      });

      const status = 200;
      hCtx.setAttribute('http.status_code', status);
      logger.info({ route, status }, 'request completed');
    });

    ctx.setStatus({ code: 1 });
  });
}

// --- Main loop ---

async function main() {
  console.log('\n🔭 otel-tui demo (continuous mode) — Ctrl+C to stop\n');

  let count = 0;

  const gracefulShutdown = async () => {
    console.log('\n📤 Flushing remaining telemetry...');
    await flush();
    await shutdown();
    console.log('✅ Shutdown complete\n');
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  while (true) {
    count++;
    try {
      await apiRequest();
      process.stdout.write(`  ↳ trace #${count}\r`);
    } catch {
      process.stdout.write(`  ↳ trace #${count} (error)\r`);
    }
    await delay(1000 + jitter(2000));
  }
}

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(max: number): number {
  return Math.floor(Math.random() * max);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

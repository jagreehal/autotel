/**
 * Cloudflare Actors example with autotel-cloudflare instrumentation
 *
 * This example demonstrates how to use @cloudflare/actors with autotel-cloudflare
 * to get comprehensive tracing of Actor lifecycle methods, storage operations, and alarms.
 *
 * @see https://github.com/cloudflare/actors
 */

import { Actor } from '@cloudflare/actors';
import { tracedHandler } from 'autotel-cloudflare/actors';
import { SamplingPresets } from 'autotel-cloudflare/sampling';
import type { worker } from '../alchemy.run.ts';

/**
 * Example Actor that demonstrates:
 * - Lifecycle method tracing (onInit, onRequest, onAlarm)
 * - Storage operations (SQL queries)
 * - Persistent properties
 * - Alarm scheduling
 */
class CounterActor extends Actor<typeof worker.Env> {
  // Persistent property - automatically persisted between requests
  // Note: The exact API may vary - this is a simplified example
  private countValue = 0;

  /**
   * onInit is automatically traced with 'actor.lifecycle': 'init'
   */
  protected async onInit(): Promise<void> {
    console.log('CounterActor initialized');
    
    // Example: Set up an alarm to run every minute
    // This will be automatically traced when triggered
    // Note: Alarm API may vary - check @cloudflare/actors docs
    try {
      // @ts-expect-error - API may vary in beta version
      if (this.alarms && typeof this.alarms.set === 'function') {
        // @ts-expect-error
        await this.alarms.set({
          scheduledTime: Date.now() + 60000, // 1 minute from now
        });
      }
    } catch (error) {
      console.warn('Could not set alarm:', error);
    }
  }

  /**
   * onRequest is automatically traced with full HTTP semantics
   * All storage operations within are also automatically traced
   */
  protected async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // GET / - Get current count
    if (method === 'GET' && url.pathname === '/') {
      return Response.json({
        count: this.countValue,
        message: 'Hello from CounterActor!',
      });
    }

    // POST /increment - Increment count
    if (method === 'POST' && url.pathname === '/increment') {
      const body = await request.json().catch(() => ({})) as { amount?: number };
      const amount = body.amount ?? 1;
      
      this.countValue += amount;
      
      return Response.json({
        count: this.countValue,
        incremented: amount,
      });
    }

    // POST /reset - Reset count
    if (method === 'POST' && url.pathname === '/reset') {
      this.countValue = 0;
      
      return Response.json({
        count: 0,
        message: 'Counter reset',
      });
    }

    // GET /storage - Example SQL query (automatically traced)
    if (method === 'GET' && url.pathname === '/storage') {
      try {
        // Example: Create a table and query it
        // All SQL operations are automatically traced
        // Note: Storage API may vary - check @cloudflare/actors docs
        // @ts-expect-error - API may vary in beta version
        if (this.storage && typeof this.storage.exec === 'function') {
          // @ts-expect-error
          await this.storage.exec(`
            CREATE TABLE IF NOT EXISTS visits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL
            )
          `);

          // @ts-expect-error
          await this.storage.exec(
            `INSERT INTO visits (timestamp) VALUES (?)`,
            [new Date().toISOString()],
          );

          // @ts-expect-error
          const visits = await this.storage.prepare(
            'SELECT * FROM visits ORDER BY timestamp DESC LIMIT 10',
          ).all();

          return Response.json({
            visits: visits.results || [],
            total: visits.results?.length || 0,
          });
        }
      } catch (error) {
        return Response.json({
          error: 'Storage not available',
          message: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
      }
    }

    // GET /alarms - Schedule a custom alarm
    if (method === 'GET' && url.pathname === '/alarms') {
      try {
        // @ts-expect-error - API may vary in beta version
        if (this.alarms && typeof this.alarms.set === 'function') {
          // @ts-expect-error
          await this.alarms.set({
            scheduledTime: Date.now() + 5000,
            data: { message: 'Custom alarm triggered!' },
          });

          return Response.json({
            message: 'Alarm scheduled for 5 seconds from now',
            scheduledTime: new Date(Date.now() + 5000).toISOString(),
          });
        }
      } catch (error) {
        return Response.json({
          error: 'Alarms not available',
          message: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * onAlarm is automatically traced with 'actor.lifecycle': 'alarm'
   * This is called when an alarm is triggered
   */
  protected async onAlarm(alarmInfo?: unknown): Promise<void> {
    console.log('Alarm triggered', { alarmInfo, count: this.countValue });
    
    // Example: Increment count on alarm
    this.countValue += 1;
    
    // Example: Schedule next alarm
    try {
      // @ts-expect-error - API may vary in beta version
      if (this.alarms && typeof this.alarms.set === 'function') {
        // @ts-expect-error
        await this.alarms.set({
          scheduledTime: Date.now() + 60000, // 1 minute from now
        });
      }
    } catch (error) {
      console.warn('Could not set alarm:', error);
    }
  }

  /**
   * Static method to extract actor name from request
   * This is used by tracedHandler to identify the actor instance
   */
  static async nameFromRequest(request: Request): Promise<string | undefined> {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || url.pathname.split('/').pop();
    return name || 'default';
  }
}

/**
 * Export the Actor class
 */
export { CounterActor };

/**
 * Export the traced handler
 * This wraps the Actor with full OpenTelemetry instrumentation
 */
// @ts-expect-error - Type compatibility issue with @cloudflare/actors beta API
export default tracedHandler(CounterActor, (env: typeof worker.Env) => ({
  exporter: {
    url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    headers: env.OTLP_HEADERS ? JSON.parse(env.OTLP_HEADERS) : {},
  },
  service: {
    name: 'counter-actor-service',
    version: '1.0.0',
  },
  // Adaptive sampling: 10% baseline, all errors, all slow requests (>1s)
  sampling: {
    tailSampler:
      env.ENVIRONMENT === 'production'
        ? SamplingPresets.production() // 10% baseline, all errors, slow >1s
        : SamplingPresets.development(), // 100% in dev
  },
  // Actor-specific instrumentation options
  actors: {
    instrumentStorage: true, // Trace SQL queries
    instrumentAlarms: true, // Trace alarm operations
    instrumentSockets: true, // Trace WebSocket operations
    capturePersistEvents: true, // Trace property persistence
  },
}));


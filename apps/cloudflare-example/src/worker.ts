import type { worker } from '../alchemy.run.ts';
import {
  instrument,
  trace,
  span,
} from 'autotel-cloudflare';
import { createEdgeLogger, runWithLogLevel } from 'autotel-cloudflare/logger';
import { getEdgeSubscribers } from 'autotel-cloudflare/events';
import { SamplingPresets } from 'autotel-cloudflare/sampling';
import { SpanStatusCode } from '@opentelemetry/api';

const log = createEdgeLogger('cloudflare-example');

// Example: Dynamic log level control per-request
// Useful for debugging specific requests without changing global log level
//
// runWithLogLevel('debug', () => {
//   log.debug('This will be logged even though logger is created with default "info" level')
//   processRequest(request)
// })

// Example traced function with attribute extractors
const processRequest = trace({
  name: 'request.process',
  attributesFromArgs: ([request]) => {
    const url = new URL(request.url);
    return {
      'http.route': url.pathname,
      'http.method': request.method,
    };
  },
  attributesFromResult: (result) => ({
    'response.has_data': !!result,
  }),
}, async function processRequest(request: Request) {
  const url = new URL(request.url);
  log.info('Processing request', { path: url.pathname });

  return {
    message: 'Hello from Alchemy!',
    timestamp: new Date().toISOString(),
    path: url.pathname,
  };
});

// Example function that uses KV (automatically instrumented) with attribute extractors
const getCachedValue = trace({
  name: 'kv.get',
  attributesFromArgs: ([key]) => ({ 'kv.key': key }),
  attributesFromResult: (value) => ({ 'kv.cache_hit': !!value }),
}, async function getCachedValue(
  key: string,
  kv: KVNamespace,
) {
  const value = await kv.get(key); // Creates span: "KV {namespace}: get"
  return value;
});

// Example function that uses R2 (automatically instrumented)
const getObject = trace({
  name: 'r2.get',
  attributesFromArgs: ([key]) => ({ 'r2.key': key }),
}, async function getObject(
  key: string,
  r2: R2Bucket,
) {
  const object = await r2.get(key); // Creates span: "R2 {bucket}: get"
  return object;
});

// Example function that uses D1 (automatically instrumented) with attribute extractors
const queryUsers = trace({
  name: 'd1.query',
  attributesFromResult: (result) => ({
    'db.rows_count': result.results?.length || 0,
  }),
}, async function queryUsers(db: D1Database) {
  const result = await db
    .prepare('SELECT * FROM users LIMIT 10')
    .all(); // Creates span: "D1 {database}: all"
  return result;
});

// Example with proper error handling and span status codes
const processPayment = trace({
  name: 'payment.process',
  attributesFromArgs: ([amount, userId]) => ({
    'payment.amount': amount,
    'payment.user_id': userId,
  }),
}, (ctx) => async function processPayment(amount: number, userId: string) {
  try {
    if (amount < 0) {
      throw new Error('Invalid amount: amount must be positive');
    }
    if (amount > 10000) {
      throw new Error('Amount exceeds limit');
    }
    
    // Simulate payment processing
    const transactionId = crypto.randomUUID();
    ctx.setAttribute('payment.transaction_id', transactionId);
    
    log.info('Payment processed', { amount, userId, transactionId });
    return { success: true, transactionId };
  } catch (error) {
    ctx.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    ctx.recordException(error instanceof Error ? error : new Error(String(error)));
    log.error('Payment failed', { error, amount, userId });
    throw error;
  }
});

// Example nested spans - validate and create user
const validateInput = trace({
  name: 'user.validate',
  attributesFromArgs: ([data]) => ({ 'user.email': data.email }),
}, async function validateInput(data: { email: string; name: string }) {
  if (!data.email) throw new Error('Email required');
  if (!data.name) throw new Error('Name required');
  if (!data.email.includes('@')) throw new Error('Invalid email format');
  return data;
});

const checkDuplicate = trace({
  name: 'db.checkDuplicate',
  attributesFromArgs: ([email]) => ({ 'user.email': email }),
  attributesFromResult: (exists) => ({ 'user.exists': exists }),
}, async function checkDuplicate(email: string, db: D1Database) {
  const result = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  return !!result;
});

const insertUser = trace({
  name: 'db.insertUser',
  attributesFromArgs: ([user]) => ({ 'user.email': user.email }),
  attributesFromResult: (user) => ({ 'user.id': user.id }),
}, async function insertUser(user: { email: string; name: string }, db: D1Database) {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
    .bind(id, user.email, user.name)
    .run();
  return { id, ...user };
});

const validateAndCreate = trace({
  name: 'user.create',
  attributesFromArgs: ([data]) => ({ 'user.email': data.email }),
  attributesFromResult: (user) => ({ 'user.id': user.id }),
}, async function validateAndCreate(
  data: { email: string; name: string },
  db: D1Database,
) {
  const valid = await validateInput(data);
  const exists = await checkDuplicate(valid.email, db);
  
  if (exists) {
    throw new Error('User already exists');
  }
  
  return await insertUser(valid, db);
});

// Handler with automatic HTTP instrumentation and all features
const handler: ExportedHandler<typeof worker.Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Demonstrate auto-instrumented bindings
    if (url.pathname === '/kv' && env.MY_KV) {
      const value = await getCachedValue('test-key', env.MY_KV);
      return Response.json({ value });
    }

    if (url.pathname === '/r2' && env.MY_R2) {
      const object = await getObject('test-object', env.MY_R2);
      return Response.json({ exists: !!object });
    }

    if (url.pathname === '/d1' && env.MY_D1) {
      const users = await queryUsers(env.MY_D1);
      return Response.json({ users });
    }

    if (url.pathname === '/service' && env.MY_SERVICE) {
      // Service binding is automatically instrumented
      const response = await env.MY_SERVICE.fetch(request); // Creates span: "Service MY_SERVICE: GET"
      return response;
    }

    // Cache instrumentation example - using span() for code blocks
    if (url.pathname === '/cache') {
      const cached = await span(
        { name: 'cache.check', attributes: { 'cache.key': url.pathname } },
        async (childSpan) => {
          const cached = await caches.default.match(request);
          childSpan.setAttribute('cache.hit', !!cached);
          return cached;
        },
      );

      if (cached) {
        return cached;
      }

      // Fetch and cache the response
      const response = await span(
        { name: 'cache.fetch_and_store' },
        async () => {
          const response = await fetch('https://api.example.com/data');
          await caches.default.put(request, response.clone());
          return response;
        },
      );

      return response;
    }

    // Distributed tracing example - trace context automatically propagated
    if (url.pathname === '/external') {
      // Trace context is automatically propagated via headers
      const response = await fetch('https://api.example.com/data', {
        headers: request.headers, // Trace context in headers
      });
      return response;
    }

    // Error handling example with payment processing
    if (url.pathname === '/payment' && request.method === 'POST') {
      try {
        const body = await request.json() as { amount: number; userId: string };
        const { amount, userId } = body;
        const result = await processPayment(amount, userId);
        return Response.json(result);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 400 },
        );
      }
    }

    // Nested spans example - create user with validation
    if (url.pathname === '/users' && request.method === 'POST') {
      try {
        const data = await request.json();
        if (!env.MY_D1) {
          return Response.json({ error: 'D1 database not configured' }, { status: 500 });
        }
        const user = await validateAndCreate(data, env.MY_D1);
        return Response.json(user, { status: 201 });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 400 },
        );
      }
    }

    // Use edge subscribers if available
    const subscribers = getEdgeSubscribers(ctx);
    if (subscribers) {
      subscribers.trackEvent('request.processed', { path: url.pathname });
    }

    const result = await processRequest(request);
    return Response.json(result);
  },

  // Scheduled handler example (works in dev mode)
  async scheduled(event, env, ctx) {
    log.info('Scheduled task executed', { cron: event.cron });
    // Your scheduled task logic here
  },

  // Queue handler example (requires paid account, but code compiles)
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      try {
        await processMessage(message);
        message.ack(); // Creates event: "messageAck" with message details
      } catch (error) {
        // Retry with delay
        message.retry({ delaySeconds: 60 });
        // Creates event: "messageRetry" with delay attribute
      }
    }
  },

  // Email handler example (requires Email Routing setup, but code compiles)
  async email(message, env, ctx) {
    log.info('Email received', {
      from: message.from,
      to: message.to,
    });
    // Email handler automatically creates spans with all headers
  },
};

async function processMessage(message: Message) {
  // Process message logic
  log.info('Processing message', { id: message.id });
}

// Export instrumented handler with all features enabled
export default instrument(handler, (env: typeof worker.Env) => ({
  exporter: {
    url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    headers: env.OTLP_HEADERS ? JSON.parse(env.OTLP_HEADERS) : {},
  },
  service: {
    name: 'cloudflare-example',
    version: '1.0.1',
  },
  // Adaptive sampling: 10% baseline, all errors, all slow requests (>1s)
  // Use SamplingPresets.highTraffic() for high-volume services
  // Use SamplingPresets.debugging() for active debugging
  // Use SamplingPresets.development() for 100% sampling in dev
  sampling: {
    tailSampler:
      env.ENVIRONMENT === 'production'
        ? SamplingPresets.production() // 10% baseline, all errors, slow >1s
        : SamplingPresets.development(), // 100% in dev
  },
  instrumentation: {
    instrumentGlobalFetch: true,
    instrumentGlobalCache: true,
    // Set to true to disable all instrumentation for local dev
    disabled: env.DISABLE_INSTRUMENTATION === 'true',
  },
  handlers: {
    fetch: {
      // Customize fetch spans with postProcess callback
      postProcess: (span, { request, response, readable }) => {
        const url = new URL(request.url);
        // Add custom attributes based on request/response
        if (url.pathname.startsWith('/api/')) {
          span.setAttribute('api.endpoint', url.pathname);
        }
        if (response.status >= 500) {
          span.setAttribute('error.severity', 'high');
        }
        // Access readable span for advanced use cases
        const duration =
          (readable.endTime[0] - readable.startTime[0]) / 1_000_000; // Convert to ms
        if (duration > 1000) {
          span.setAttribute('performance.slow', true);
        }
      },
    },
  },
}));

import type { WorkerEnv } from './types';
import {
  wrapModule,
  trace,
  span,
  instrumentRateLimiter,
  instrumentBrowserRendering,
  createEdgeLogger,
  runWithLogLevel,
  getEdgeSubscribers,
  SamplingPresets,
} from 'autotel/workers';
import { SpanStatusCode } from '@opentelemetry/api';

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const log = createEdgeLogger('cloudflare-example', {
  level: 'info', // 'debug' | 'info' | 'warn' | 'error' | 'none'
  pretty: true, // human-readable output for dev; omit or false for JSON in prod
  bindings: { region: 'local' }, // merged into every log entry
  redact: 'default', // uses the same sensitive-key patterns as the main autotel package
});

// Dynamic log level control per-request
// Overrides the logger level for the duration of the callback
// Useful for debugging specific requests without changing global log level
function withDebugLogging<T>(fn: () => T): T {
  return runWithLogLevel('debug', fn);
}

// Example traced function with attribute extractors
const processRequest = trace(
  {
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
  },
  async function processRequest(request: Request) {
    const url = new URL(request.url);
    log.info({ path: url.pathname }, 'Processing request');

    return {
      message: 'Hello from Alchemy!',
      timestamp: new Date().toISOString(),
      path: url.pathname,
    };
  },
);

// Example function that uses KV (automatically instrumented) with attribute extractors
const getCachedValue = trace(
  {
    name: 'kv.get',
    attributesFromArgs: ([key]) => ({ 'kv.key': key }),
    attributesFromResult: (value) => ({ 'kv.cache_hit': !!value }),
  },
  async function getCachedValue(key: string, kv: KVNamespace) {
    const value = await kv.get(key); // Creates span: "KV {namespace}: get"
    return value;
  },
);

// Example function that uses R2 (automatically instrumented)
const getObject = trace(
  {
    name: 'r2.get',
    attributesFromArgs: ([key]) => ({ 'r2.key': key }),
  },
  async function getObject(key: string, r2: R2Bucket) {
    const object = await r2.get(key); // Creates span: "R2 {bucket}: get"
    return object;
  },
);

// Example function that uses D1 (automatically instrumented) with attribute extractors
const queryUsers = trace(
  {
    name: 'd1.query',
    attributesFromResult: (result: D1Result<Record<string, unknown>>) => ({
      'db.rows_count': result.results?.length || 0,
    }),
  },
  async function queryUsers(db: D1Database) {
    const result = await db.prepare('SELECT * FROM users LIMIT 10').all(); // Creates span: "D1 {database}: all"
    return result;
  },
);

// Example: Workers AI with auto-traced model call
const generateText = trace(
  {
    name: 'ai.generate',
    attributesFromArgs: ([prompt]) => ({ 'ai.prompt_length': prompt.length }),
    attributesFromResult: (result) => ({ 'ai.has_response': !!result }),
  },
  async function generateText(prompt: string, ai: Ai) {
    const result = await ai.run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [{ role: 'user', content: prompt }],
    });
    return result;
  },
);

// Example: Vectorize with auto-traced vector search
const searchVectors = trace(
  {
    name: 'vectorize.search',
    attributesFromArgs: ([_vector, topK]) => ({ 'vectorize.top_k': topK }),
    attributesFromResult: (result: VectorizeMatches) => ({
      'vectorize.matches': result?.matches?.length || 0,
    }),
  },
  async function searchVectors(
    vector: number[],
    topK: number,
    index: VectorizeIndex,
  ) {
    const result = await index.query(vector, { topK });
    return result;
  },
);

// Example: Queue producer with auto-traced message send
const enqueueMessage = trace(
  {
    name: 'queue.enqueue',
    attributesFromArgs: ([data]) => ({ 'queue.message_type': typeof data }),
  },
  async function enqueueMessage(data: unknown, queue: Queue) {
    await queue.send(data);
  },
);

// Example: Analytics Engine with auto-traced write
const trackAnalytics = trace(
  {
    name: 'analytics.track',
    attributesFromArgs: ([event]) => ({ 'analytics.event': event }),
  },
  function trackAnalytics(event: string, ae: AnalyticsEngineDataset) {
    ae.writeDataPoint({
      indexes: [event],
      doubles: [Date.now()],
      blobs: [event],
    });
  },
);

// Example: Combined AI → Vectorize → Queue pipeline (trace context propagation)
const aiSearchPipeline = trace(
  {
    name: 'pipeline.ai-search',
    attributesFromArgs: ([query]) => ({ 'pipeline.query': query }),
    attributesFromResult: (result: VectorizeMatches) => ({
      'pipeline.matches_found': result.matches?.length || 0,
    }),
  },
  async function aiSearchPipeline(
    query: string,
    ai: Ai,
    index: VectorizeIndex,
    queue: Queue,
  ) {
    // Step 1: Generate embeddings with AI
    const embedding = (await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: query,
    })) as any;
    const vector: number[] = embedding?.data?.[0] || [];

    // Step 2: Search Vectorize for similar vectors
    const searchResult = await index.query(vector, { topK: 5 });

    // Step 3: Queue the results for async processing
    await queue.send({ query, matches: searchResult.matches });

    return searchResult;
  },
);

// Example with proper error handling and span status codes
const processPayment = trace(
  {
    name: 'payment.process',
    attributesFromArgs: ([amount, userId]) => ({
      'payment.amount': amount,
      'payment.user_id': userId,
    }),
  },
  (ctx) =>
    async function processPayment(amount: number, userId: string) {
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

        log.info({ amount, userId, transactionId }, 'Payment processed');
        return { success: true, transactionId };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        ctx.recordError(error);
        log.error(
          {
            amount,
            userId,
            err: error instanceof Error ? error : new Error(String(error)),
          },
          'Payment failed',
        );
        throw error;
      }
    },
);

// Example nested spans - validate and create user
const validateInput = trace(
  {
    name: 'user.validate',
    attributesFromArgs: ([data]) => ({ 'user.email': data.email }),
  },
  async function validateInput(data: { email: string; name: string }) {
    if (!data.email) throw new Error('Email required');
    if (!data.name) throw new Error('Name required');
    if (!data.email.includes('@')) throw new Error('Invalid email format');
    return data;
  },
);

const checkDuplicate = trace(
  {
    name: 'db.checkDuplicate',
    attributesFromArgs: ([email]) => ({ 'user.email': email }),
    attributesFromResult: (exists) => ({ 'user.exists': exists }),
  },
  async function checkDuplicate(email: string, db: D1Database) {
    const result = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    return !!result;
  },
);

const insertUser = trace(
  {
    name: 'db.insertUser',
    attributesFromArgs: ([user]) => ({ 'user.email': user.email }),
    attributesFromResult: (user: { id: string; email: string; name: string }) => ({ 'user.id': user.id }),
  },
  async function insertUser(
    user: { email: string; name: string },
    db: D1Database,
  ) {
    const id = crypto.randomUUID();
    await db
      .prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .bind(id, user.email, user.name)
      .run();
    return { id, ...user };
  },
);

const validateAndCreate = trace(
  {
    name: 'user.create',
    attributesFromArgs: ([data]) => ({ 'user.email': data.email }),
    attributesFromResult: (user: { id: string; email: string; name: string }) => ({ 'user.id': user.id }),
  },
  async function validateAndCreate(
    data: { email: string; name: string },
    db: D1Database,
  ) {
    const valid = await validateInput(data);
    const exists = await checkDuplicate(valid.email, db);

    if (exists) {
      throw new Error('User already exists');
    }

    return await insertUser(valid, db);
  },
);

// Handler with automatic HTTP instrumentation and all features
const handler: ExportedHandler<WorkerEnv> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Child logger — inherits parent bindings, adds request-scoped context
    // Like pino's child(): every log from reqLog includes these fields
    const reqLog = log.child({
      method: request.method,
      path: url.pathname,
      requestId: request.headers.get('cf-ray') || crypto.randomUUID(),
    });

    // Demonstrate runWithLogLevel: force debug for /debug path
    if (url.pathname === '/debug') {
      return withDebugLogging(() => {
        reqLog.debug('Debug mode enabled for this request');
        reqLog.info('This debug log would normally be filtered at info level');
        return Response.json({ debug: true });
      });
    }

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

    // AI binding - automatically instrumented via instrumentBindings()
    if (url.pathname === '/ai' && env.AI) {
      const prompt = url.searchParams.get('prompt') || 'Tell me a joke';
      const result = await generateText(prompt, env.AI);
      return Response.json(result);
    }

    // Vectorize binding - automatically instrumented
    if (url.pathname === '/vectorize' && env.VECTORIZE) {
      const vector = Array.from({ length: 768 }, () => Math.random());
      const result = await searchVectors(vector, 5, env.VECTORIZE);
      return Response.json(result);
    }

    // Queue producer - automatically instrumented
    if (url.pathname === '/queue' && env.MY_QUEUE) {
      await enqueueMessage(
        { event: 'test', timestamp: Date.now() },
        env.MY_QUEUE,
      );
      return Response.json({ sent: true });
    }

    // Analytics Engine - automatically instrumented
    if (url.pathname === '/analytics' && env.AE) {
      trackAnalytics('page_view', env.AE);
      return Response.json({ tracked: true });
    }

    // Combined pipeline: AI → Vectorize → Queue (shows trace context propagation)
    if (
      url.pathname === '/ai-search' &&
      env.AI &&
      env.VECTORIZE &&
      env.MY_QUEUE
    ) {
      const query = url.searchParams.get('q') || 'example search';
      const result = await aiSearchPipeline(
        query,
        env.AI,
        env.VECTORIZE,
        env.MY_QUEUE,
      );
      return Response.json(result);
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
      // Trace context is automatically injected by global fetch instrumentation
      const response = await fetch('https://api.example.com/data');
      return response;
    }

    // Error handling example with payment processing
    if (url.pathname === '/payment' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          amount: number;
          userId: string;
        };
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
        const data = (await request.json()) as { email: string; name: string };
        if (!env.MY_D1) {
          return Response.json(
            { error: 'D1 database not configured' },
            { status: 500 },
          );
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
    log.info({ cron: event.cron }, 'Scheduled task executed');
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
    log.info(
      {
        from: message.from,
        to: message.to,
      },
      'Email received',
    );
    // Email handler automatically creates spans with all headers
  },
};

async function processMessage(message: Message) {
  // Process message logic
  log.info({ id: message.id }, 'Processing message');
}

// Export instrumented handler with all features enabled
export default wrapModule((env: WorkerEnv) => ({
  exporter: {
    url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    headers: parseHeaders(env.OTLP_HEADERS),
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
        const durationMs =
          (readable.endTime[0] - readable.startTime[0]) * 1000 +
          (readable.endTime[1] - readable.startTime[1]) / 1_000_000;
        if (durationMs > 1000) {
          span.setAttribute('performance.slow', true);
        }
      },
    },
  },
}), handler);

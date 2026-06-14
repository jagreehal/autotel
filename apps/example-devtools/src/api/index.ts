import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { getTraceContext, trace, createStructuredError } from 'autotel';
import { injectTraceContext } from 'autotel/http';
import type { TraceContext } from 'autotel';
import { useLogger } from 'autotel-adapters/hono';
import { otel } from 'autotel-hono';
import { desc, eq, sql } from 'drizzle-orm';
import { createDb, schema } from '../shared/db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, '..', 'web');
const autotelWebDistDir = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'autotel-web',
  'dist',
);

const indexHtmlTemplate = readFileSync(join(webDir, 'index.html'), 'utf8');
const appScript = readFileSync(join(webDir, 'app.js'), 'utf8');
const appStyles = readFileSync(join(webDir, 'style.css'), 'utf8');
const faviconSvg = readFileSync(join(webDir, 'favicon.svg'));

const db = createDb();
const {
  users,
  products,
  orders,
  orderItems,
  notificationJobs,
} = schema;

export interface ApiServiceConfig {
  authUrl: string;
  workerUrl: string;
  devtoolsUrl: string;
  browserServiceName: string;
  apiServiceName: string;
  authServiceName: string;
  workerServiceName: string;
}

function buildHtml(config: ApiServiceConfig): string {
  const clientConfig = JSON.stringify({
    devtoolsUrl: config.devtoolsUrl,
    serviceNames: {
      browser: config.browserServiceName,
      api: config.apiServiceName,
      auth: config.authServiceName,
      worker: config.workerServiceName,
      db: 'sqlite',
    },
  });

  return indexHtmlTemplate
    .replaceAll('__DEVTOOLS_URL__', config.devtoolsUrl)
    .replace(
      '</head>',
      `  <script>window.__SHOWCASE_CONFIG__ = ${clientConfig};</script>\n</head>`,
    );
}

function safeVendorFile(name: string): string | null {
  if (!name || name.includes('..') || name.includes('\\')) return null;
  return resolve(autotelWebDistDir, name);
}

function attachTraceHeaders(c: Context, devtoolsUrl: string): void {
  const traceContext = getTraceContext();
  if (!traceContext) return;
  c.header('x-trace-id', traceContext.traceId);
  c.header('x-trace-url', `${devtoolsUrl}/#trace=${traceContext.traceId}`);
  c.header('Access-Control-Expose-Headers', 'x-trace-id, x-trace-url');
}

const fetchCatalog = trace('fetchCatalog', (ctx: TraceContext) => async (category: string | undefined) => {
  ctx.setAttribute('shop.flow', 'catalog');
  ctx.setAttribute('db.operation', 'select');
  ctx.setAttribute('db.table', 'products');
  if (category) {
    ctx.setAttribute('shop.category', category);
  }

  return category
    ? db.select().from(products).where(eq(products.category, category)).all()
    : db.select().from(products).orderBy(desc(products.featured), products.name).all();
});

const fetchProfile = trace('fetchProfile', (ctx: TraceContext) => async (userId: number) => {
  ctx.setAttribute('shop.flow', 'profile');
  ctx.setAttribute('shop.user_id', userId);
  return db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      orders: {
        with: {
          items: {
            with: {
              product: true,
            },
          },
        },
      },
      notificationJobs: true,
    },
  });
});

const createOrder = trace(
  'createOrder',
  (ctx: TraceContext) =>
    async (
      userId: number,
      items: Array<{ productId: number; quantity: number }>,
    ) => {
      ctx.setAttribute('shop.flow', 'checkout');
      ctx.setAttribute('shop.user_id', userId);
      ctx.setAttribute('order.item_count', items.length);

      return db.transaction(async (tx) => {
        let total = 0;
        const lineItems: Array<{
          productId: number;
          quantity: number;
          price: number;
        }> = [];

        for (const item of items) {
          const product = await tx.query.products.findFirst({
            where: eq(products.id, item.productId),
          });

          if (!product) {
            throw createStructuredError({
              message: `Product ${item.productId} not found`,
              status: 404,
              why: 'The requested product is missing from the catalog.',
              fix: 'Refresh the catalog and choose a product that is still in stock.',
            });
          }

          if (product.stock < item.quantity) {
            throw createStructuredError({
              message: `${product.name} is low on stock`,
              status: 409,
              why: `Only ${product.stock} unit(s) remain, but ${item.quantity} were requested.`,
              fix: 'Reduce the quantity or choose another featured product.',
            });
          }

          total += product.price * item.quantity;
          lineItems.push({
            productId: product.id,
            quantity: item.quantity,
            price: product.price,
          });
        }

        const [order] = await tx
          .insert(orders)
          .values({
            userId,
            total,
            status: 'confirmed',
          })
          .returning();

        for (const item of lineItems) {
          await tx.insert(orderItems).values({
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          });

          await tx
            .update(products)
            .set({ stock: sql`${products.stock} - ${item.quantity}` })
            .where(eq(products.id, item.productId))
            .run();
        }

        return order;
      });
    },
);

const slowInventoryReport = trace('slowInventoryReport', (ctx: TraceContext) => async () => {
  ctx.setAttribute('shop.flow', 'inventory-report');
  ctx.setAttribute('db.query.type', 'recursive-cte');
  ctx.setAttribute('db.query.iterations', 1_200_000);

  const countRows = await db.all(sql`
    WITH RECURSIVE c(n) AS (
      SELECT 1
      UNION ALL
      SELECT n + 1 FROM c WHERE n < 1200000
    )
    SELECT count(*) AS total FROM c
  `);

  const catalog = await db.select().from(products).all();
  const seriesTotal = Number((countRows[0] as { total?: number })?.total ?? 0);

  return {
    totalProducts: catalog.length,
    lowStock: catalog.filter((product) => product.stock < 10).length,
    totalValue: catalog.reduce(
      (sum, product) => sum + product.price * product.stock,
      0,
    ),
    recursiveCount: seriesTotal,
  };
});

const callAiRecommendation = trace(
  'callAiRecommendation',
  (ctx: TraceContext) => async (category: string, budget: number) => {
    ctx.setAttribute('gen_ai.provider.name', 'openai');
    ctx.setAttribute('gen_ai.operation.name', 'chat');
    ctx.setAttribute('gen_ai.request.model', 'gpt-4o-mini');
    ctx.setAttribute('gen_ai.usage.input_tokens', 188);
    ctx.setAttribute('gen_ai.usage.output_tokens', 134);
    ctx.setAttribute('shop.flow', 'genai-recommendation');

    const matches = await db
      .select()
      .from(products)
      .where(eq(products.category, category))
      .all();
    const picks = matches.filter((product) => product.price <= budget).slice(0, 3);

    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, 140 + Math.random() * 160),
    );

    return {
      model: 'gpt-4o-mini',
      tokens: { input: 188, output: 134 },
      recommendations: picks.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        reason: `${product.name} keeps the bundle under $${budget} and matches ${category}.`,
      })),
    };
  },
);

const callSupportCopilot = trace('callSupportCopilot', (ctx: TraceContext) => async (question: string) => {
  ctx.setAttribute('gen_ai.provider.name', 'anthropic');
  ctx.setAttribute('gen_ai.operation.name', 'chat');
  ctx.setAttribute('gen_ai.request.model', 'claude-3-5-sonnet');
  ctx.setAttribute('gen_ai.usage.input_tokens', 256);
  ctx.setAttribute('gen_ai.usage.output_tokens', 176);
  ctx.setAttribute('shop.flow', 'genai-support');

  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, 180 + Math.random() * 120),
  );

  return {
    model: 'claude-3-5-sonnet',
    confidence: 0.94,
    tokens: { input: 256, output: 176 },
    answer: `For "${question}", the fastest path is to open the order timeline in devtools, confirm auth succeeded, then follow the worker notification span to the final status.`,
  };
});

const validateAuth = (
  authUrl: string,
) =>
  trace('validateSession', (ctx: TraceContext) => async (token: string) => {
    ctx.setAttribute('shop.flow', 'auth-hop');
    ctx.setAttribute('auth.token_prefix', token.slice(0, 8));

    const response = await fetch(`${authUrl}/validate`, {
      method: 'POST',
      // Inject W3C traceparent + baggage so shop-auth continues this trace
      // instead of starting a new root. This is what links the browser-root
      // trace through shop-api into shop-auth in the service map.
      headers: injectTraceContext({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      throw createStructuredError({
        message: 'Authentication failed',
        status: response.status,
        why: 'The auth service rejected the current session token.',
        fix: 'Switch persona or re-run the request with an active session.',
      });
    }

    return response.json() as Promise<{
      userId: number;
      email: string;
      name: string;
      segment: string;
      sessionId: number;
    }>;
  });

const notifyWorker = (workerUrl: string) =>
  trace('sendWorkerNotification', (ctx: TraceContext) => async (orderId: number, userId: number) => {
    ctx.setAttribute('shop.flow', 'worker-hop');
    ctx.setAttribute('worker.order_id', orderId);
    ctx.setAttribute('worker.user_id', userId);

    const response = await fetch(`${workerUrl}/notify`, {
      method: 'POST',
      // Inject W3C traceparent + baggage so shop-worker continues this trace
      // and the worker notification hop shows up under the same checkout trace.
      headers: injectTraceContext({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        orderId,
        userId,
        type: 'order_confirmation',
      }),
    });

    if (!response.ok) {
      throw createStructuredError({
        message: 'Worker notification failed',
        status: response.status,
        why: 'The worker could not persist or process the notification job.',
        fix: 'Inspect the worker-service spans and retry the checkout flow.',
      });
    }

    return response.json() as Promise<{
      status: string;
      jobId: number;
      orderId: number;
    }>;
  });

export function createApiApp(config: ApiServiceConfig): Hono {
  const app = new Hono();
  const validateSession = validateAuth(config.authUrl);
  const sendWorkerNotification = notifyWorker(config.workerUrl);
  const otelMiddleware = otel({
    serviceName: config.apiServiceName,
    captureRequestHeaders: ['user-agent'],
    captureResponseHeaders: ['content-type', 'x-trace-id'],
  });

  const shouldBypassTelemetry = (path: string): boolean =>
    path === '/' ||
    path === '/app.js' ||
    path === '/style.css' ||
    path === '/health' ||
    path === '/v1/traces' ||
    path.startsWith('/vendor/autotel-web/');

  app.post('/v1/traces', async (c) => {
    const contentType = c.req.header('content-type') || 'application/json';
    const body = await c.req.arrayBuffer();

    const response = await fetch(`${config.devtoolsUrl}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('content-type') || 'application/json',
      },
    });
  });

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: config.apiServiceName,
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/', (c) => c.html(buildHtml(config)));

  app.get('/app.js', (c) =>
    c.body(appScript, 200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
    }),
  );

  app.get('/style.css', (c) =>
    c.body(appStyles, 200, {
      'Content-Type': 'text/css',
      'Cache-Control': 'no-store',
    }),
  );

  app.get('/favicon.svg', (c) =>
    c.body(faviconSvg, 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    }),
  );

  app.get('/favicon.ico', (c) =>
    c.body(faviconSvg, 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    }),
  );

  app.get('/vendor/autotel-web/:file', (c) => {
    const requested = c.req.param('file');
    const safePath = safeVendorFile(requested);
    if (!safePath) return c.text('Not found', 404);

    try {
      const body = readFileSync(safePath);
      return c.body(body, 200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
    } catch {
      return c.text('Not found', 404);
    }
  });

  app.use('*', async (c, next) => {
    if (shouldBypassTelemetry(c.req.path)) {
      await next();
      return;
    }

    return otelMiddleware(c, next);
  });

  app.use('*', async (c, next) => {
    await next();
    attachTraceHeaders(c, config.devtoolsUrl);
  });

  app.get('/api/products', async (c) => {
    const log = useLogger(c);
    log.set({ endpoint: '/api/products', flow: 'catalog' });

    const category = c.req.query('category') || undefined;
    const catalog = await fetchCatalog(category);

    log.info('Loaded catalog', {
      category: category ?? 'all',
      count: catalog.length,
    });

    return c.json({
      products: catalog,
      category: category ?? 'all',
    });
  });

  app.get('/api/users/:id', async (c) => {
    const log = useLogger(c);
    const userId = Number(c.req.param('id'));
    const token =
      (c.req.header('Authorization') || 'Bearer demo-token').replace(
        'Bearer ',
        '',
      );

    log.set({
      endpoint: '/api/users/:id',
      flow: 'profile',
      userId,
    });

    const identity = await validateSession(token);
    log.set({
      authUserId: identity.userId,
      authSegment: identity.segment,
    });

    const profile = await fetchProfile(userId);
    if (!profile) {
      const error = createStructuredError({
        message: `User ${userId} not found`,
        status: 404,
        why: 'The profile requested by the browser does not exist.',
        fix: 'Switch persona or request a seeded user from the showcase.',
      });
      log.error(error, { userId });
      return c.json(
        {
          message: error.message,
          why: error.why,
          fix: error.fix,
        },
        404,
      );
    }

    log.info('Loaded profile', {
      orderCount: profile.orders.length,
      notificationCount: profile.notificationJobs.length,
    });

    return c.json({
      profile,
      identity,
    });
  });

  app.post('/api/checkout', async (c) => {
    const log = useLogger(c);
    const token =
      (c.req.header('Authorization') || 'Bearer demo-token').replace(
        'Bearer ',
        '',
      );
    const { items } = await c.req.json<{
      items: Array<{ productId: number; quantity: number }>;
    }>();

    log.set({
      endpoint: '/api/checkout',
      flow: 'checkout',
      itemCount: items.length,
    });

    const identity = await validateSession(token);
    const order = await createOrder(identity.userId, items);
    const workerJob = await sendWorkerNotification(order.id, identity.userId);

    const recentJobs = await db
      .select()
      .from(notificationJobs)
      .where(eq(notificationJobs.orderId, order.id))
      .orderBy(desc(notificationJobs.createdAt))
      .all();

    log.info('Checkout completed', {
      orderId: order.id,
      notificationJobs: recentJobs.length,
    });

    return c.json({
      message: 'Checkout confirmed and notification job processed.',
      order,
      workerJob,
      recentJobs,
      identity,
    });
  });

  app.get('/api/reports/inventory', async (c) => {
    const log = useLogger(c);
    log.set({
      endpoint: '/api/reports/inventory',
      flow: 'inventory-report',
    });

    const report = await slowInventoryReport();
    log.info('Inventory report complete', report);
    return c.json(report);
  });

  app.post('/api/ai/recommend', async (c) => {
    const log = useLogger(c);
    const { category, budget } = await c.req.json<{
      category: string;
      budget: number;
    }>();
    log.set({
      endpoint: '/api/ai/recommend',
      flow: 'genai-recommendation',
      category,
      budget,
    });

    const result = await callAiRecommendation(category, budget);
    log.info('Recommendation complete', {
      recommendationCount: result.recommendations.length,
    });

    return c.json(result);
  });

  app.post('/api/ai/support', async (c) => {
    const log = useLogger(c);
    const { question } = await c.req.json<{ question: string }>();
    log.set({
      endpoint: '/api/ai/support',
      flow: 'genai-support',
    });

    const result = await callSupportCopilot(question);
    log.info('Support copilot answered', {
      confidence: result.confidence,
    });

    return c.json(result);
  });

  app.get('/api/error', (c) => {
    const log = useLogger(c);
    log.warn('Triggering structured payment error');

    const error = createStructuredError({
      message: 'Payment authorization failed',
      status: 402,
      why: 'The mock gateway declined the selected card after auth succeeded.',
      fix: 'Retry with the Demo User persona or inspect the auth-service trace first.',
      link: `${config.devtoolsUrl}/#errors`,
      code: 'SHOWCASE_PAYMENT_DECLINED',
    });

    log.error(error, { flow: 'error-demo' });

    return c.json(
      {
        message: error.message,
        why: error.why,
        fix: error.fix,
        link: error.link,
        code: error.code,
      },
      402,
    );
  });

  return app;
}

export function startApi(port: number, config: ApiServiceConfig): void {
  const app = createApiApp(config);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`  🛒 API service    → http://127.0.0.1:${info.port}`);
  });
}

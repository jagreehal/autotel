import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createStructuredError, trace } from 'autotel';
import type { TraceContext } from 'autotel';
import { useLogger } from 'autotel-adapters/hono';
import { otel } from 'autotel-hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '../shared/db/client.js';

const db = createDb();
const { sessions } = schema;

export function createAuthApp(serviceName: string): Hono {
  const app = new Hono();

  app.use(
    '*',
    otel({
      serviceName,
      captureResponseHeaders: ['content-type'],
    }),
  );

  const lookupSession = trace('lookupSession', (ctx: TraceContext) => async (token: string) => {
    ctx.setAttribute('auth.token_prefix', token.slice(0, 8));
    ctx.setAttribute('shop.flow', 'auth-validation');
    return db.query.sessions.findFirst({
      where: eq(sessions.token, token),
      with: {
        user: true,
      },
    });
  });

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: serviceName,
      timestamp: new Date().toISOString(),
    }),
  );

  app.post('/validate', async (c) => {
    const log = useLogger(c);
    const { token } = await c.req.json<{ token?: string }>();

    if (!token) {
      throw createStructuredError({
        message: 'Token is required',
        status: 400,
        why: 'The API called auth-service without a bearer token.',
        fix: 'Send a seeded showcase token such as demo-token or alice-token.',
      });
    }

    log.set({
      endpoint: '/validate',
      tokenPrefix: token.slice(0, 8),
    });

    const session = await lookupSession(token);
    if (!session || session.status !== 'active') {
      throw createStructuredError({
        message: 'Invalid or expired session',
        status: 401,
        why: 'The token is not present in the sessions table or is no longer active.',
        fix: 'Switch persona in the web app and retry the request.',
      });
    }

    await db
      .update(sessions)
      .set({ lastValidatedAt: new Date() })
      .where(eq(sessions.id, session.id))
      .run();

    log.info('Validated session', {
      userId: session.userId,
      segment: session.user.segment,
    });

    return c.json({
      sessionId: session.id,
      userId: session.userId,
      email: session.user.email,
      name: session.user.name,
      segment: session.user.segment,
      scope: session.scope,
    });
  });

  return app;
}

export function startAuth(port: number, serviceName: string): void {
  const app = createAuthApp(serviceName);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`  🔐 Auth service   → http://127.0.0.1:${info.port}`);
  });
}

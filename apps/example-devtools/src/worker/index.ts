import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createStructuredError, trace } from 'autotel';
import type { TraceContext } from 'autotel';
import { useLogger } from 'autotel-adapters/hono';
import { otel } from 'autotel-hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '../shared/db/client.js';

const db = createDb();
const { notificationJobs } = schema;

export function createWorkerApp(serviceName: string): Hono {
  const app = new Hono();

  app.use(
    '*',
    otel({
      serviceName,
      captureResponseHeaders: ['content-type'],
    }),
  );

  const queueNotification = trace(
    'queueNotification',
    (ctx: TraceContext) =>
      async (orderId: number, userId: number, type: string) => {
        ctx.setAttribute('shop.flow', 'worker-queue');
        ctx.setAttribute('worker.type', type);
        const [job] = await db
          .insert(notificationJobs)
          .values({
            orderId,
            userId,
            type,
            status: 'queued',
          })
          .returning();
        return job;
      },
  );

  const deliverNotification = trace('deliverNotification', (ctx: TraceContext) => async (jobId: number) => {
    ctx.setAttribute('shop.flow', 'worker-delivery');
    ctx.setAttribute('worker.job_id', jobId);
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, 90 + Math.random() * 110),
    );
    return db
      .update(notificationJobs)
      .set({
        status: 'delivered',
        attempts: 1,
        processedAt: new Date(),
      })
      .where(eq(notificationJobs.id, jobId))
      .run();
  });

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: serviceName,
      timestamp: new Date().toISOString(),
    }),
  );

  app.post('/notify', async (c) => {
    const log = useLogger(c);
    const { orderId, userId, type } = await c.req.json<{
      orderId?: number;
      userId?: number;
      type?: string;
    }>();

    if (!orderId || !userId || !type) {
      throw createStructuredError({
        message: 'Worker payload is incomplete',
        status: 400,
        why: 'orderId, userId, and type are required for notification processing.',
        fix: 'Call /notify with the structured checkout payload.',
      });
    }

    log.set({
      endpoint: '/notify',
      orderId,
      userId,
      type,
    });

    const job = await queueNotification(orderId, userId, type);
    await deliverNotification(job.id);

    const latestJob = await db.query.notificationJobs.findFirst({
      where: eq(notificationJobs.id, job.id),
    });

    log.info('Notification delivered', {
      jobId: job.id,
      status: latestJob?.status ?? 'unknown',
    });

    return c.json({
      status: latestJob?.status ?? 'delivered',
      jobId: job.id,
      orderId,
    });
  });

  return app;
}

export function startWorker(port: number, serviceName: string): void {
  const app = createWorkerApp(serviceName);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`  ⚙️  Worker service → http://127.0.0.1:${info.port}`);
  });
}

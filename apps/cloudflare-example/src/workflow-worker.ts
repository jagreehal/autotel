/**
 * Worker entrypoint for OrderWorkflow
 *
 * This worker demonstrates autotel-cloudflare/handlers Workflow instrumentation.
 * It provides HTTP endpoints to create and check workflow instances.
 *
 * The OrderWorkflow class uses instrumentWorkflow() to automatically trace:
 * - Workflow run() execution with workflow attributes
 * - Each step.do() call as a child span
 * - Each step.sleep() call as a child span
 * - Cold starts and error handling
 */

import { instrument } from 'autotel-cloudflare';
import { SamplingPresets } from 'autotel-cloudflare/sampling';
import { OrderWorkflow } from './workflow';

// Export the Workflow class for binding configuration
export { OrderWorkflow };

interface Env {
  ORDER_WORKFLOW: Workflow;
  OTLP_ENDPOINT?: string;
  OTLP_HEADERS?: string;
  ENVIRONMENT?: string;
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API info
    if (url.pathname === '/') {
      return Response.json({
        message: 'OrderWorkflow Worker with OpenTelemetry Observability',
        info: 'This worker demonstrates autotel-cloudflare Workflow instrumentation',
        endpoints: {
          info: 'GET / - This info',
          create: 'POST /workflows - Create a new workflow instance',
          get: 'GET /workflows/:id - Get workflow instance status',
        },
        observability:
          'OrderWorkflow uses instrumentWorkflow() to trace run(), step.do(), and step.sleep()',
      });
    }

    // Create workflow instance
    if (url.pathname === '/workflows' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          orderId?: string;
          customerId?: string;
          items?: Array<{ productId: string; quantity: number; price: number }>;
        };

        const orderId = body.orderId || `order-${Date.now()}`;
        const customerId = body.customerId || 'customer-1';
        const items = body.items || [
          { productId: 'prod-1', quantity: 2, price: 29.99 },
          { productId: 'prod-2', quantity: 1, price: 49.99 },
        ];
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const instance = await env.ORDER_WORKFLOW.create({
          id: `wf-${orderId}`,
          params: { orderId, customerId, items, total },
        });

        return Response.json({
          instanceId: instance.id,
          orderId,
          total,
          status: 'created',
        }, { status: 201 });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 },
        );
      }
    }

    // Get workflow instance status
    if (url.pathname.startsWith('/workflows/') && request.method === 'GET') {
      try {
        const instanceId = url.pathname.split('/workflows/')[1];
        if (!instanceId) {
          return Response.json({ error: 'Missing instance ID' }, { status: 400 });
        }

        const instance = await env.ORDER_WORKFLOW.get(instanceId);
        const status = await instance.status();

        return Response.json({
          instanceId,
          status: status.status,
          output: status.output,
          error: status.error,
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 },
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

export default instrument(handler, (env: Env) => ({
  exporter: {
    url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    headers: env.OTLP_HEADERS ? JSON.parse(env.OTLP_HEADERS) : {},
  },
  service: {
    name: 'order-workflow-worker',
    version: '1.0.0',
  },
  sampling: {
    tailSampler:
      env.ENVIRONMENT === 'production'
        ? SamplingPresets.production()
        : SamplingPresets.development(),
  },
}));

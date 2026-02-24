/**
 * Cloudflare Workflows example with autotel-cloudflare instrumentation
 *
 * This example demonstrates how to use Cloudflare Workflows with autotel-cloudflare
 * to get comprehensive tracing of workflow execution, step operations, and sleeps.
 *
 * @see https://developers.cloudflare.com/workflows/
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { instrumentWorkflow } from 'autotel-cloudflare/handlers';
import { createEdgeLogger } from 'autotel-cloudflare/logger';
import { SamplingPresets } from 'autotel-cloudflare/sampling';

const log = createEdgeLogger('order-workflow');

interface OrderPayload {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  total: number;
}

interface WorkflowEnv {
  OTLP_ENDPOINT?: string;
  OTLP_HEADERS?: string;
  ENVIRONMENT?: string;
}

/**
 * Example Workflow that demonstrates:
 * - step.do() with automatic span creation
 * - step.do() with retry configuration
 * - step.sleep() with automatic span creation
 * - Error handling with proper span status codes
 * - Cold start tracking
 * - Workflow chaining patterns
 */
class OrderWorkflowBase extends WorkflowEntrypoint<WorkflowEnv, OrderPayload> {
  async run(event: WorkflowEvent<OrderPayload>, step: WorkflowStep): Promise<void> {
    const { orderId, customerId, items, total } = event.payload;

    log.info('workflow.started', { orderId, customerId, total, instanceId: event.instanceId });

    // Step 1: Validate the order
    const validation = await step.do('validate order', async () => {
      if (!orderId) throw new Error('Missing orderId');
      if (!items || items.length === 0) throw new Error('Order has no items');
      if (total <= 0) throw new Error('Invalid order total');

      log.info('order.validated', { orderId, itemCount: items.length });
      return { valid: true, itemCount: items.length };
    });

    // Step 2: Reserve inventory (with retries for transient failures)
    const reservation = await step.do(
      'reserve inventory',
      {
        retries: { limit: 3, delay: '1 second', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        // Simulate inventory check
        const reservationId = `res-${Date.now()}`;
        log.info('inventory.reserved', { orderId, reservationId });
        return { reservationId, itemsReserved: items.length };
      },
    );

    // Step 3: Process payment (with retries)
    const payment = await step.do(
      'process payment',
      {
        retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' },
        timeout: '60 seconds',
      },
      async () => {
        // Simulate payment processing
        const transactionId = `txn-${Date.now()}`;
        log.info('payment.processed', { orderId, transactionId, total });
        return { transactionId, amount: total, status: 'completed' };
      },
    );

    // Step 4: Wait for payment settlement
    await step.sleep('wait for payment settlement', '5 seconds');

    // Step 5: Fulfill order
    const fulfillment = await step.do('fulfill order', async () => {
      const trackingNumber = `TRK-${Date.now()}`;
      log.info('order.fulfilled', {
        orderId,
        trackingNumber,
        transactionId: payment.transactionId,
      });
      return { trackingNumber, status: 'shipped' };
    });

    // Step 6: Send confirmation
    await step.do('send confirmation', async () => {
      log.info('confirmation.sent', {
        orderId,
        customerId,
        trackingNumber: fulfillment.trackingNumber,
      });
      return { notified: true };
    });

    log.info('workflow.completed', {
      orderId,
      customerId,
      instanceId: event.instanceId,
      reservationId: reservation.reservationId,
      transactionId: payment.transactionId,
      trackingNumber: fulfillment.trackingNumber,
    });
  }
}

/**
 * Export the instrumented Workflow class
 *
 * instrumentWorkflow wraps the WorkflowEntrypoint to automatically:
 * - Create a root span for run() with workflow attributes
 * - Create child spans for each step.do() call
 * - Create child spans for each step.sleep() call
 * - Track cold starts
 * - Record errors with proper span status codes
 * - Propagate trace context through the workflow
 */
export const OrderWorkflow = instrumentWorkflow(
  OrderWorkflowBase,
  'order-workflow',
  (env: WorkflowEnv) => ({
    exporter: {
      url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      headers: env.OTLP_HEADERS ? JSON.parse(env.OTLP_HEADERS) : {},
    },
    service: {
      name: 'order-workflow-service',
      version: '1.0.0',
    },
    sampling: {
      tailSampler:
        env.ENVIRONMENT === 'production'
          ? SamplingPresets.production()
          : SamplingPresets.development(),
    },
  }),
);

/**
 * Kitchen Sink Example - Comprehensive awaitly + autotel integration
 * 
 * This demonstrates:
 * - Successful workflows with visualization
 * - Error handling with visualization
 * - Decision tracking
 * - Cache behavior
 * - Console logging
 * - All OpenTelemetry features
 * - Production-ready patterns
 */

import 'dotenv/config';
import { createWorkflow } from 'awaitly/workflow';
import { createAutotelAdapter, withAutotelTracing } from 'awaitly/otel';
import { createVisualizer, trackIf } from 'awaitly/visualize';
import { createConsoleLogger } from 'awaitly/devtools';
import { trace } from 'autotel';
import pino from 'pino';
import { ok, err, type Result } from 'awaitly';

const logger = pino({
  name: 'awaitly-kitchen-sink',
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

// ============================================================================
// Business Logic - Using Result types for proper error handling
// ============================================================================

type UserNotFound = { type: 'USER_NOT_FOUND'; userId: string };
type CardDeclined = { type: 'CARD_DECLINED'; amount: number; reason: string };
type EmailFailed = { type: 'EMAIL_FAILED'; to: string; error: string };

const fetchUser = async (
  id: string
): Promise<Result<
  { id: string; name: string; email: string; isPremium: boolean },
  UserNotFound
>> => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (id === 'error-user') {
    return err({ type: 'USER_NOT_FOUND', userId: id });
  }
  return ok({
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    isPremium: id === 'user-premium',
  });
};

const chargeCard = async (
  amount: number
): Promise<Result<
  { transactionId: string; amount: number; status: string },
  CardDeclined
>> => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (amount > 1000) {
    return err({
      type: 'CARD_DECLINED',
      amount,
      reason: 'Amount too high',
    });
  }
  return ok({
    transactionId: `tx-${Date.now()}`,
    amount,
    status: 'success',
  });
};

const sendEmail = async (
  to: string,
  subject: string
): Promise<Result<{ sent: boolean; to: string; subject: string }, EmailFailed>> => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (to.includes('fail')) {
    return err({
      type: 'EMAIL_FAILED',
      to,
      error: 'SMTP server unavailable',
    });
  }
  return ok({
    sent: true,
    to,
    subject,
  });
};

const fetchPremiumData = async (
  userId: string
): Promise<Result<{ premiumFeatures: string[]; userId: string }, never>> => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  return ok({
    premiumFeatures: ['feature1', 'feature2', 'feature3'],
    userId,
  });
};

const fetchBasicData = async (
  userId: string
): Promise<Result<{ basicFeatures: string[]; userId: string }, never>> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return ok({
    basicFeatures: ['feature1'],
    userId,
  });
};

// ============================================================================
// Example 1: Successful Workflow with All Features
// ============================================================================

async function example1_SuccessfulWorkflow() {
  logger.info('\n✅ Example 1: Successful Workflow');
  logger.info('   Demonstrates successful execution with all observability features\n');

  const autotel = createAutotelAdapter({
    serviceName: 'checkout-service',
    createStepSpans: true,
    recordMetrics: true,
    recordRetryEvents: true,
    markErrorsOnSpan: true,
    defaultAttributes: {
      environment: 'development',
      workflow: 'checkout',
    },
  });

  const viz = createVisualizer({
    workflowName: 'successful-checkout',
  });

  const consoleLogger = createConsoleLogger({
    prefix: '[checkout]',
    colors: true,
  });

  const deps = {
    fetchUser,
    chargeCard,
    sendEmail,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
      consoleLogger(event);
    },
  });

  const result = await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser('user-123'), {
      name: 'Fetch user',
    });

    const charge = await step(() => deps.chargeCard(99.99), {
      name: 'Charge card',
    });

    const email = await step(
      () => deps.sendEmail(user.email, 'Order confirmation'),
      { name: 'Send email' }
    );

    return { user, charge, email };
  });

  if (result.ok) {
    logger.info({ result: result.value }, '✅ Checkout completed successfully\n');
  } else {
    logger.error({ error: result.error }, '❌ Checkout failed\n');
  }

  // Show metrics
  const metrics = autotel.getMetrics();
  logger.info({ metrics }, '📊 Collected metrics');

  // Show visualizations
  logger.info('\n📊 ASCII Visualization:');
  logger.info(viz.render());

  logger.info('\n📊 Mermaid Visualization:');
  logger.info(viz.renderAs('mermaid'));
}

// ============================================================================
// Example 2: Error Handling
// ============================================================================

async function example2_ErrorHandling() {
  logger.info('\n⚠️  Example 2: Error Handling');
  logger.info('   Demonstrates error tracking in spans and visualization\n');

  const autotel = createAutotelAdapter({
    serviceName: 'error-service',
    createStepSpans: true,
    recordMetrics: true,
    markErrorsOnSpan: true,
  });

  const viz = createVisualizer({
    workflowName: 'error-handling-demo',
  });

  const deps = {
    fetchUser,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
    },
  });

  const result = await workflow(async (step, deps) => {
    // This will fail
    const user = await step(() => deps.fetchUser('error-user'), {
      name: 'Fetch user (will fail)',
    });
    return { user };
  });

  if (result.ok) {
    logger.info({ result: result.value }, '✅ Workflow succeeded\n');
  } else {
    logger.error({ error: result.error }, '❌ Expected error (user not found)\n');
  }

  // Show metrics
  const metrics = autotel.getMetrics();
  logger.info({ metrics }, '📊 Error metrics');

  // Show visualization
  logger.info('\n📊 Visualization (shows error):');
  logger.info(viz.render());
}

// ============================================================================
// Example 3: Decision Tracking
// ============================================================================

async function example3_DecisionTracking() {
  logger.info('\n🎯 Example 3: Decision Tracking');
  logger.info('   Tracks conditional logic and visualizes branching\n');

  const autotel = createAutotelAdapter({
    serviceName: 'user-service',
    createStepSpans: true,
    recordMetrics: true,
  });

  const viz = createVisualizer({
    workflowName: 'user-data-fetch',
  });

  const deps = {
    fetchUser,
    fetchPremiumData,
    fetchBasicData,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
    },
  });

  const result = await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser('user-premium'), {
      name: 'Fetch user',
    });

    // Track decision
    const decision = trackIf('check-premium', user.isPremium, {
      condition: 'user.isPremium',
      emit: viz.handleDecisionEvent,
    });

    let data;
    if (decision.condition) {
      decision.then();
      data = await step(() => deps.fetchPremiumData(user.id), {
        name: 'Fetch premium data',
      });
    } else {
      decision.else();
      data = await step(() => deps.fetchBasicData(user.id), {
        name: 'Fetch basic data',
      });
    }
    decision.end();

    return { user, data };
  });

  if (result.ok) {
    logger.info({ result: result.value }, '✅ User data fetched\n');
  } else {
    logger.error({ error: result.error }, '❌ Failed to fetch user data\n');
  }

  // Show visualization with decision tracking
  logger.info('\n📊 Visualization with Decision Tracking:');
  logger.info(viz.render());

  logger.info('\n📊 Mermaid with Decisions:');
  logger.info(viz.renderAs('mermaid'));
}

// ============================================================================
// Example 4: Cache Behavior
// ============================================================================

async function example4_CacheBehavior() {
  logger.info('\n🔄 Example 4: Cache Behavior');
  logger.info('   Shows retry events and cache hits/misses\n');

  const autotel = createAutotelAdapter({
    serviceName: 'cache-service',
    createStepSpans: true,
    recordMetrics: true,
    recordRetryEvents: true,
  });

  const viz = createVisualizer({
    workflowName: 'cache-demo',
  });

  const consoleLogger = createConsoleLogger({
    prefix: '[cache]',
    colors: true,
  });

  const deps = {
    fetchUser,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
      consoleLogger(event);
    },
  });

  const result = await workflow(async (step, deps) => {
    // First call - cache miss
    const user1 = await step(() => deps.fetchUser('user-789'), {
      name: 'Fetch user (first)',
      key: 'user-789',
    });

    // Second call with same key - cache hit
    const user2 = await step(() => deps.fetchUser('user-789'), {
      name: 'Fetch user (cached)',
      key: 'user-789',
    });

    return { user1, user2 };
  });

  if (result.ok) {
    logger.info({ result: result.value }, '✅ Completed with caching\n');
  } else {
    logger.error({ error: result.error }, '❌ Error in cache example\n');
  }

  // Show metrics
  const metrics = autotel.getMetrics();
  logger.info(
    {
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      stepDurations: metrics.stepDurations,
    },
    '📊 Cache statistics'
  );

  // Show visualization
  logger.info('\n📊 Visualization (shows cache hits):');
  logger.info(viz.render());
}

// ============================================================================
// Example 5: With Autotel Tracing
// ============================================================================

async function example5_WithAutotelTracing() {
  logger.info('\n🎯 Example 5: With Autotel Tracing');
  logger.info('   Wraps workflow in trace span with full observability\n');

  const autotel = createAutotelAdapter({
    serviceName: 'traced-service',
    createStepSpans: true,
    recordMetrics: true,
  });

  const viz = createVisualizer({
    workflowName: 'traced-checkout',
  });

  const deps = {
    fetchUser,
    chargeCard,
    sendEmail,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
    },
  });

  const tracedCheckout = withAutotelTracing(trace, {
    serviceName: 'traced-service',
  });

  const workflowResult = await tracedCheckout(
    'complete-checkout',
    async () => {
      return workflow(async (step, deps) => {
        const user = await step(() => deps.fetchUser('user-999'), {
          name: 'Fetch user',
        });
        const charge = await step(() => deps.chargeCard(199.99), {
          name: 'Charge card',
        });
        const email = await step(
          () => deps.sendEmail(user.email, 'Welcome!'),
          { name: 'Send welcome email' }
        );
        return { user, charge, email };
      });
    },
    {
      workflow: 'checkout',
      version: '1.0',
    }
  );

  if (workflowResult.ok) {
    logger.info({ result: workflowResult.value }, '✅ Complete checkout finished\n');
  } else {
    logger.error({ error: workflowResult.error }, '❌ Combined approach failed\n');
  }

  // Show visualization
  logger.info('\n📊 Final Visualization:');
  logger.info(viz.render());

  logger.info('\n📊 Mermaid Diagram:');
  logger.info(viz.renderAs('mermaid'));
}

// ============================================================================
// Example 6: Multiple Error Scenarios
// ============================================================================

async function example6_MultipleErrors() {
  logger.info('\n🔴 Example 6: Multiple Error Scenarios');
  logger.info('   Shows different error types and recovery\n');

  const autotel = createAutotelAdapter({
    serviceName: 'error-scenarios',
    createStepSpans: true,
    recordMetrics: true,
    markErrorsOnSpan: true,
  });

  const viz = createVisualizer({
    workflowName: 'error-scenarios',
  });

  const deps = {
    fetchUser,
    chargeCard,
    sendEmail,
  };

  const workflow = createWorkflow(deps, {
    onEvent: (event) => {
      autotel.handleEvent(event);
      viz.handleEvent(event);
    },
  });

  // Test 1: User not found
  logger.info('Test 1: User not found');
  const result1 = await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser('error-user'), {
      name: 'Fetch user',
    });
    return { user };
  });
  logger.info({ ok: result1.ok, error: result1.ok ? null : result1.error }, '');

  // Test 2: Card declined
  logger.info('Test 2: Card declined (amount too high)');
  const result2 = await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser('user-123'), {
      name: 'Fetch user',
    });
    const charge = await step(() => deps.chargeCard(2000), {
      name: 'Charge card',
    });
    return { user, charge };
  });
  logger.info({ ok: result2.ok, error: result2.ok ? null : result2.error }, '');

  // Test 3: Email failed
  logger.info('Test 3: Email failed');
  const result3 = await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser('user-123'), {
      name: 'Fetch user',
    });
    const email = await step(
      () => deps.sendEmail('fail@example.com', 'Test'),
      { name: 'Send email' }
    );
    return { user, email };
  });
  logger.info({ ok: result3.ok, error: result3.ok ? null : result3.error }, '');

  // Show metrics
  const metrics = autotel.getMetrics();
  logger.info({ metrics }, '📊 Error scenario metrics');

  // Show visualization
  logger.info('\n📊 Visualization (shows all error scenarios):');
  logger.info(viz.render());
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('🚀 Starting awaitly + autotel kitchen sink example...\n');

  try {
    await example1_SuccessfulWorkflow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await example2_ErrorHandling();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await example3_DecisionTracking();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await example4_CacheBehavior();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await example5_WithAutotelTracing();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await example6_MultipleErrors();

    logger.info('\n✅ All examples completed!');
    logger.info('📊 Check your OpenTelemetry backend for traces and metrics');
    logger.info('📈 Visualizations shown above demonstrate workflow execution');
  } catch (error) {
    logger.error(error, '❌ Error running examples');
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  logger.error(error, '❌ Fatal error:');
  process.exit(1);
});

export { main };

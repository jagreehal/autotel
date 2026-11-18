/**
 * awaitly + autotel.
 *
 * `init()` in instrumentation.ts registers the tracer, meter and context
 * manager. awaitly 7.1 reads them and opens `run <workflow>`, `step <name>`
 * and `attempt <name>` spans itself and puts retries, cache hits, decisions
 * and skipped steps on its spans as events. No adapter. With an endpoint set,
 * it also records `awaitly.workflow.duration`, `awaitly.step.duration` and
 * `awaitly.step.retries`.
 *
 * `createVisualizer` reads the same run from `onEvent` and draws it.
 */

import 'dotenv/config';
import {
  annotateSpan,
  createWorkflow,
  err,
  ok,
  type AsyncResult,
  type WorkflowEvent,
} from 'awaitly';
import { createVisualizer } from 'awaitly-visualizer';
import { createConsoleLogger } from 'awaitly-visualizer/devtools';
import { shutdown, trace } from 'autotel';
import pino from 'pino';

const logger = pino({
  name: 'example-awaitly',
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Dependencies: Result-returning functions
// ============================================================================

interface User {
  id: string;
  email: string;
  isPremium: boolean;
}

const fetchUser = async (
  id: string,
): AsyncResult<User, { type: 'USER_NOT_FOUND'; userId: string }> => {
  await pause(30);
  if (id === 'missing') return err({ type: 'USER_NOT_FOUND', userId: id });
  return ok({ id, email: `${id}@example.com`, isPremium: id === 'premium' });
};

const chargeCard = async (
  amount: number,
): AsyncResult<
  { transactionId: string; amount: number },
  { type: 'CARD_DECLINED'; reason: string }
> => {
  await pause(60);
  if (amount > 1000) return err({ type: 'CARD_DECLINED', reason: 'limit' });
  return ok({ transactionId: `tx-${Date.now()}`, amount });
};

let gatewayCalls = 0;
/** Times out twice, then succeeds: something for `retry` to do. */
const chargeThroughGateway = async (
  amount: number,
): AsyncResult<
  { transactionId: string; amount: number },
  { type: 'GATEWAY_TIMEOUT' }
> => {
  await pause(20);
  gatewayCalls += 1;
  if (gatewayCalls % 3 !== 0) return err({ type: 'GATEWAY_TIMEOUT' });
  return ok({ transactionId: `tx-${Date.now()}`, amount });
};

const sendEmail = async (
  to: string,
  subject: string,
): AsyncResult<{ to: string; subject: string }, { type: 'EMAIL_FAILED' }> => {
  await pause(20);
  return ok({ to, subject });
};

const fetchPremiumOffers = async (
  userId: string,
): AsyncResult<string[], never> => {
  await pause(25);
  return ok([`offer-a-${userId}`, `offer-b-${userId}`]);
};

const fetchStandardOffers = async (
  userId: string,
): AsyncResult<string[], never> => {
  await pause(15);
  return ok([`offer-${userId}`]);
};

const deps = {
  fetchUser,
  chargeCard,
  chargeThroughGateway,
  sendEmail,
  fetchPremiumOffers,
  fetchStandardOffers,
};

/** The visualizer and a console log, both reading the workflow's events. */
function observe(name: string) {
  const viz = createVisualizer({ workflowName: name });
  const log = createConsoleLogger({ prefix: `[${name}]`, colors: true });
  const onEvent = (event: WorkflowEvent<unknown>) => {
    viz.handleEvent(event);
    log(event);
  };
  return { viz, onEvent };
}

// ============================================================================
// 1. Checkout: run and step spans, run-wide attributes, annotateSpan()
// ============================================================================

async function checkout() {
  logger.info('1. Checkout: one trace, a span per step');
  const { viz, onEvent } = observe('checkout');

  const workflow = createWorkflow('checkout', deps, {
    onEvent,
    attributes: { 'deployment.environment.name': 'development' },
  });

  // `attributes` lands on the run span and every span inside it.
  const result = await workflow.run(
    async ({ step, deps }) => {
      const user = await step('fetchUser', () => deps.fetchUser('user-1'));
      const charge = await step('chargeCard', () => {
        annotateSpan({ 'payment.provider': 'stripe' });
        return deps.chargeCard(99.99);
      });
      await step('sendEmail', () =>
        deps.sendEmail(user.email, 'Order confirmation'),
      );
      return charge;
    },
    { attributes: { 'tenant.id': 'acme' } },
  );

  logger.info({ ok: result.ok }, 'checkout finished');
  logger.info(`\n${viz.render()}`);
}

// ============================================================================
// 2. A typed error: the step and run spans fail with error.type
// ============================================================================

async function typedError() {
  logger.info('2. Typed error: error.type and an exception event, no payload');
  const { viz, onEvent } = observe('load-account');

  const workflow = createWorkflow('load-account', deps, { onEvent });
  const result = await workflow.run(async ({ step, deps }) =>
    step('fetchUser', () => deps.fetchUser('missing')),
  );

  logger.info(
    { error: result.ok ? undefined : result.error },
    'expected failure',
  );
  logger.info(`\n${viz.render()}`);
}

// ============================================================================
// 3. Retries: an attempt span each, awaitly.step.retry events, a retries metric
// ============================================================================

async function retries() {
  logger.info('3. Retries: attempt spans and retry events on the step');
  const { viz, onEvent } = observe('charge-with-retry');

  const workflow = createWorkflow('charge-with-retry', deps, { onEvent });
  const result = await workflow.run(async ({ step, deps }) =>
    step('chargeThroughGateway', () => deps.chargeThroughGateway(42), {
      retry: { attempts: 3, backoff: 'fixed', initialDelay: 50 },
    }),
  );

  logger.info({ ok: result.ok, calls: gatewayCalls }, 'charged after retries');
  logger.info(`\n${viz.render()}`);
}

// ============================================================================
// 4. Decisions: step.if records an awaitly.decision event with the branch
// ============================================================================

async function decisions() {
  logger.info('4. Decision: the branch taken, as a span event');
  const { viz, onEvent } = observe('offers');

  const workflow = createWorkflow('offers', deps, { onEvent });
  const result = await workflow.run(async ({ step, deps }) => {
    const user = await step('fetchUser', () => deps.fetchUser('premium'));
    if (step.if('premium-check', 'user.isPremium', () => user.isPremium)) {
      return step('fetchPremiumOffers', () => deps.fetchPremiumOffers(user.id));
    }
    return step('fetchStandardOffers', () => deps.fetchStandardOffers(user.id));
  });

  logger.info({ offers: result.ok ? result.value : [] }, 'offers loaded');
  logger.info(`\n${viz.renderAs('mermaid')}`);
}

// ============================================================================
// 5. Cache: the second step with the same key is an awaitly.step.cache_hit event
// ============================================================================

async function cache() {
  logger.info('5. Cache: a hit is an event on the run span, not a new step');
  const { viz, onEvent } = observe('profile');

  const workflow = createWorkflow('profile', deps, {
    onEvent,
    cache: new Map(),
  });
  await workflow.run(async ({ step, deps }) => {
    await step('fetchUser', () => deps.fetchUser('user-7'), { key: 'user:7' });
    return step('fetchUser', () => deps.fetchUser('user-7'), { key: 'user:7' });
  });

  logger.info(`\n${viz.render()}`);
}

// ============================================================================
// 6. An entry point: autotel trace() around a handler no step calls
// ============================================================================

/**
 * awaitly already opens the run and step spans, so `trace()` goes on the
 * handler that calls the workflow, not around steps. The run span nests under
 * it.
 */
const handleCheckoutRequest = trace(
  'POST /checkout',
  async (userId: string, amount: number) => {
    const workflow = createWorkflow('checkout', deps);
    return workflow.run(async ({ step, deps }) => {
      await step('fetchUser', () => deps.fetchUser(userId));
      return step('chargeCard', () => deps.chargeCard(amount));
    });
  },
);

async function entryPoint() {
  logger.info('6. Entry point: the run span nests under the request span');
  const declined = await handleCheckoutRequest('user-1', 2000);
  logger.info(
    { error: declined.ok ? undefined : declined.error },
    'card declined inside POST /checkout',
  );
}

async function main() {
  logger.info('awaitly + autotel: span trees print after each run\n');
  await checkout();
  await typedError();
  await retries();
  await decisions();
  await cache();
  await entryPoint();
  // Exports what is still batched, so the last runs print too.
  await shutdown();
}

await main();

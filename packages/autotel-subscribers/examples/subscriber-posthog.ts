/**
 * PostHog Subscriber - Complete Feature Showcase
 *
 * This example demonstrates all PostHog subscriber capabilities:
 * - Basic event tracking
 * - Feature flags and A/B testing
 * - Person and group events (B2B SaaS)
 * - Serverless configuration
 * - Custom client injection
 * - Error handling
 *
 * Install dependencies:
 * ```bash
 * pnpm add autotel autotel-subscribers posthog-node
 * ```
 */

import { Events } from 'autotel/events';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
import { PostHog } from 'posthog-node';

// ============================================================================
// Example 1: Basic Event Tracking
// ============================================================================

async function basicEventTracking() {
  const events = new Events('my-app', {
    subscribers: [
      new PostHogSubscriber({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: 'https://us.i.posthog.com', // or 'https://eu.i.posthog.com' for EU cloud
      }),
    ],
  });

  // Track events
  events.trackEvent('user.signed_up', {
    userId: 'user-123',
    plan: 'premium',
    source: 'landing_page',
  });

  // Track funnel steps
  events.trackFunnelStep('checkout', 'started', {
    userId: 'user-123',
    cartValue: 99.99,
  });

  events.trackFunnelStep('checkout', 'completed', {
    userId: 'user-123',
    orderId: 'order-456',
  });

  // Track outcomes
  events.trackOutcome('payment.processing', 'success', {
    userId: 'user-123',
    amount: 99.99,
  });

  // Track values/metrics
  events.trackValue('revenue', 99.99, {
    userId: 'user-123',
    currency: 'USD',
  });

  await events.shutdown();
}

// ============================================================================
// Example 2: Feature Flags and A/B Testing
// ============================================================================

async function featureFlagsExample() {
  const _subscriber = new PostHogSubscriber({
    apiKey: process.env.POSTHOG_API_KEY!,
  });

  const userId = 'user-123';

  // Check if a feature is enabled (boolean)
  const hasNewCheckout = await subscriber.isFeatureEnabled('new-checkout', userId);

  if (hasNewCheckout) {
    console.log('Show new checkout UI');
  } else {
    console.log('Show old checkout UI');
  }

  // Get feature flag value (for multivariate tests)
  const experimentVariant = await subscriber.getFeatureFlag('pricing-experiment', userId);

  switch (experimentVariant) {
    case 'control': {
      console.log('Show $99/month price');
      break;
    }
    case 'test-1': {
      console.log('Show $89/month price');
      break;
    }
    case 'test-2': {
      console.log('Show $79/month price');
      break;
    }
    default: {
      console.log('User not in experiment');
    }
  }

  // Get all flags for a user (useful for client-side rendering)
  const allFlags = await subscriber.getAllFlags(userId);
  console.log('All feature flags:', allFlags);
  // { 'new-checkout': true, 'pricing-experiment': 'test-1', ... }

  // Feature flags with person properties
  const isPremiumFeatureEnabled = await subscriber.getFeatureFlag('premium-events', userId, {
    personProperties: {
      plan: 'premium',
      signupDate: '2025-01-01',
    },
  });
  console.log('Premium events enabled:', isPremiumFeatureEnabled);

  // Feature flags with group context (for B2B features)
  const isBetaEnabled = await subscriber.isFeatureEnabled('beta-features', userId, {
    groups: { company: 'acme-corp' },
    groupProperties: {
      company: {
        plan: 'enterprise',
        employees: 500,
      },
    },
  });
  console.log('Beta features enabled:', isBetaEnabled);

  // Reload feature flags from server (without restarting)
  await subscriber.reloadFeatureFlags();

  await subscriber.shutdown();
}

// ============================================================================
// Example 3: Person and Group Events (B2B SaaS)
// ============================================================================

async function personAndGroupEvents() {
  const _subscriber = new PostHogSubscriber({
    apiKey: process.env.POSTHOG_API_KEY!,
  });

  // Identify a user and set their properties
  await subscriber.identify('user-123', {
    $set: {
      email: 'user@acme-corp.com',
      name: 'John Doe',
      plan: 'premium',
      company: 'Acme Corporation',
    },
  });

  // Set properties only once (won't update if already exists)
  await subscriber.identify('user-123', {
    $set_once: {
      signup_date: '2025-01-17',
      first_utm_source: 'google',
    },
  });

  // Identify a group (e.g., company/organization)
  await subscriber.groupIdentify('company', 'acme-corp', {
    $set: {
      name: 'Acme Corporation',
      industry: 'SaaS',
      employees: 500,
      plan: 'enterprise',
      mrr: 50_000,
    },
  });

  // Track events with group context
  await subscriber.trackEventWithGroups(
    'feature.used',
    {
      userId: 'user-123',
      feature: 'advanced-events',
    },
    {
      company: 'acme-corp',
      team: 'engineering',
    },
  );

  // This allows you to:
  // 1. Analyze usage by company/team in PostHog
  // 2. Enable features for specific companies
  // 3. Track company-level metrics

  await subscriber.shutdown();
}

// ============================================================================
// Example 4: Serverless Configuration (AWS Lambda, Vercel, Cloudflare)
// ============================================================================

async function serverlessConfiguration() {
  // For serverless environments, optimize for immediate sending
  const _subscriber = new PostHogSubscriber({
    apiKey: process.env.POSTHOG_API_KEY!,

    // Send events immediately (don't batch)
    flushAt: 1,

    // Disable interval-based flushing
    flushInterval: 0,

    // Reduce request timeout for faster function execution
    requestTimeout: 3000,

    // Disable geoip lookup to reduce request size
    disableGeoip: true,
  });

  // In a Lambda handler:
  // exports.handler = async (event) => {
  //   const events = new Events('my-lambda', {
  //     subscribers: [adapter]
  //   });
  //
  //   events.trackEvent('lambda.invoked', { userId: event.userId });
  //
  //   // IMPORTANT: Always call shutdown in serverless!
  //   // This ensures events are flushed before function terminates
  //   await events.shutdown();
  //
  //   return { statusCode: 200 };
  // }

  await subscriber.shutdown();
}

// ============================================================================
// Example 5: Custom PostHog Client
// ============================================================================

async function customClientExample() {
  // Create your own PostHog client with custom configuration
  const customClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: 'https://eu.i.posthog.com',
    flushAt: 10,
    flushInterval: 5000,
    requestTimeout: 10_000,
    // Any other PostHog client options...
  });

  // Pass the custom client to the subscriber
  const _subscriber = new PostHogSubscriber({
    client: customClient,
  });

  // Now you can use the subscriber with your custom client configuration
  const events = new Events('my-app', {
    subscribers: [adapter],
  });

  events.trackEvent('custom.event', { userId: 'user-123' });

  await events.shutdown();
}

// ============================================================================
// Example 6: Error Handling and Debugging
// ============================================================================

async function errorHandlingExample() {
  const _subscriber = new PostHogSubscriber({
    apiKey: process.env.POSTHOG_API_KEY!,

    // Enable debug logging
    debug: true,

    // Custom error handler
    onError: (error) => {
      console.error('PostHog error:', error);

      // Send to your error tracking service
      // Sentry.captureException(error);
      // or
      // logger.error('PostHog error', { error });
    },
  });

  const events = new Events('my-app', {
    subscribers: [adapter],
  });

  // If PostHog API is down, errors will be caught and logged
  // but won't crash your application
  events.trackEvent('test.event', { userId: 'user-123' });

  await events.shutdown();
}

// ============================================================================
// Example 7: Complete B2B SaaS Example
// ============================================================================

async function completeSaaSExample() {
  const _subscriber = new PostHogSubscriber({
    apiKey: process.env.POSTHOG_API_KEY!,
    onError: (error) => console.error('PostHog error:', error),
  });

  const events = new Events('my-saas-app', {
    subscribers: [adapter],
  });

  const userId = 'user-123';
  const companyId = 'acme-corp';

  // 1. User signs up
  await subscriber.identify(userId, {
    $set: {
      email: 'john@acme-corp.com',
      name: 'John Doe',
      role: 'Admin',
    },
    $set_once: {
      signup_date: new Date().toISOString(),
    },
  });

  events.trackEvent('user.signed_up', {
    userId,
    plan: 'trial',
  });

  // 2. Identify the company
  await subscriber.groupIdentify('company', companyId, {
    $set: {
      name: 'Acme Corporation',
      plan: 'trial',
      employees: 50,
    },
  });

  // 3. Check if company has access to beta features
  const hasBetaAccess = await subscriber.isFeatureEnabled('beta-features', userId, {
    groups: { company: companyId },
  });

  if (hasBetaAccess) {
    // 4. Track feature usage with company context
    await subscriber.trackEventWithGroups(
      'beta_feature.used',
      {
        userId,
        feature: 'advanced-events',
      },
      { company: companyId },
    );
  }

  // 5. User upgrades to premium
  await subscriber.identify(userId, {
    $set: { plan: 'premium' },
  });

  await subscriber.groupIdentify('company', companyId, {
    $set: {
      plan: 'premium',
      upgraded_at: new Date().toISOString(),
    },
  });

  events.trackOutcome('upgrade.flow', 'success', {
    userId,
    plan: 'premium',
    amount: 99.99,
  });

  events.trackValue('revenue', 99.99, {
    userId,
    plan: 'premium',
  });

  await events.shutdown();
}

// ============================================================================
// Run Examples
// ============================================================================

async function main() {
  console.log('PostHog Subscriber Examples\n');

  // Uncomment the examples you want to run:
  // await basicEventTracking();
  // await featureFlagsExample();
  // await personAndGroupEvents();
  // await serverlessConfiguration();
  // await customClientExample();
  // await errorHandlingExample();
  // await completeSaaSExample();

  console.log('\nExamples completed!');
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  basicEventTracking,
  featureFlagsExample,
  personAndGroupEvents,
  serverlessConfiguration,
  customClientExample,
  errorHandlingExample,
  completeSaaSExample,
};

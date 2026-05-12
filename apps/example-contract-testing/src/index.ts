#!/usr/bin/env node

/**
 * Contract Testing Observability Demo
 *
 * This demo shows how Autotel instruments contract testing workflows with:
 * - Phase tracing (consumer.generate, pacts.sync, pacts.normalize, provider.verify)
 * - Pair-level audits with structured attributes
 * - Deterministic error codes for failed checks
 * - Product events for trend analysis
 * - Automatic redaction of sensitive fields
 */

import { init, shutdown, span, trace } from 'autotel';
import {
  createContractObservabilityRunner,
  type ContractPairResult,
} from './contract-observability.js';

/**
 * Initialize Autotel with OTLP endpoint and redaction policies
 */
init({
  service: 'example-contract-testing',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  debug: process.env.DEBUG === 'true',
  attributeRedactor: {
    keyPatterns: [/authorization/i, /token/i, /cookie/i, /secret/i],
    valuePatterns: [
      {
        name: 'bearer-token',
        pattern: /bearer\s+[a-z0-9._-]+/gi,
        replacement: '[REDACTED_BEARER]',
      },
      {
        name: 'api-key',
        pattern: /api[_-]?key[=:]\s*[a-z0-9._-]+/gi,
        replacement: '[REDACTED_API_KEY]',
      },
    ],
  },
});

const runner = createContractObservabilityRunner();

/**
 * Three contract pair scenarios representing different failure modes
 */
const scenarios: ContractPairResult[] = [
  {
    // Healthy pair: passes all checks
    consumer: 'admin',
    provider: 'account',
    file: 'admin-consumer-account-provider.json',
    stale: false,
    syncGap: false,
    missingProviderCopy: false,
    uncommitted: false,
    verificationFailed: false,
    diffType: 'none',
  },
  {
    // Stale + uncommitted: has UUID noise diff (typically safe to ignore)
    consumer: 'digest',
    provider: 'membership',
    file: 'digest-consumer-membership-provider.json',
    stale: true,
    syncGap: false,
    missingProviderCopy: false,
    uncommitted: true,
    verificationFailed: false,
    diffType: 'uuid-noise',
    diffNoiseFields: ['request.path', 'providerStates.params.userId'],
    reason: 'Uncommitted pact diff appears to be UUID-only noise.',
  },
  {
    // Critical: missing provider copy + verification failed (requires manual intervention)
    consumer: 'reconciler',
    provider: 'messagequeue',
    file: 'reconciler-consumer-messagequeue-provider.json',
    stale: false,
    syncGap: true,
    missingProviderCopy: true,
    uncommitted: false,
    verificationFailed: true,
    diffType: 'semantic-change',
    reason:
      'Provider payload no longer matches expected contract shape for message status enum.',
  },
];

/**
 * Run the contract observability demo
 */
async function runDemo(): Promise<void> {
  const startTime = Date.now();

  console.log('\n📋 Contract Testing Observability Demo');
  console.log('═'.repeat(50));
  console.log(`Endpoint: ${process.env.OTLP_ENDPOINT || 'http://localhost:4318'}`);
  console.log(`Service: example-contract-testing`);
  console.log('');

  try {
    const summary = await span('contract.demo.run', async () => {
      return runner.run(
        {
          service: 'letterbox',
          mode: 'full',
          consumers: ['admin', 'digest', 'reconciler'],
          providers: ['account', 'membership', 'messagequeue'],
        },
        async () => {
          console.log('🔄 Running contract workflow phases...\n');

          await trace('consumer.generate', async () => {
            console.log('  ✓ consumer.generate (40ms)');
            await wait(40);
          });

          await trace('pacts.sync', async () => {
            console.log('  ✓ pacts.sync (30ms)');
            await wait(30);
          });

          await trace('pacts.normalize', async () => {
            console.log('  ✓ pacts.normalize (20ms)');
            await wait(20);
          });

          await trace('provider.verify', async () => {
            console.log('  ✓ provider.verify (50ms)');
            await wait(50);
          });

          console.log('');
          return scenarios;
        },
      );
    });

    const elapsed = Date.now() - startTime;

    // Summary table
    console.log('📊 Contract Health Summary');
    console.log('─'.repeat(50));
    console.table(summary);

    // Pair statuses
    console.log('📦 Pair Statuses');
    console.log('─'.repeat(50));
    console.table(
      scenarios.map((s) => ({
        pair: `${s.consumer} → ${s.provider}`,
        status: inferStatusIcon(s),
        file: s.file,
        stale: s.stale ? '⚠️' : '-',
        syncGap: s.syncGap ? '⚠️' : '-',
        missingProvider: s.missingProviderCopy ? '❌' : '-',
        uncommitted: s.uncommitted ? '⚠️' : '-',
        verifyFailed: s.verificationFailed ? '❌' : '-',
        diffType: s.diffType,
      })),
    );

    // Final status
    console.log('');
    console.log('═'.repeat(50));
    const statusEmoji = summary.status === 'ok' ? '✅' : summary.status === 'warn' ? '⚠️' : '❌';
    console.log(`${statusEmoji} Final Status: ${summary.status.toUpperCase()}`);
    console.log(`⏱️  Total Time: ${elapsed}ms`);
    console.log('═'.repeat(50));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Demo failed:', message);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

/**
 * Helper to return status icon
 */
function inferStatusIcon(pair: ContractPairResult): string {
  if (pair.verificationFailed || pair.missingProviderCopy) return '❌ FAIL';
  if (pair.stale || pair.syncGap || pair.uncommitted) return '⚠️  WARN';
  return '✅ OK';
}

/**
 * Sleep utility for simulating work
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the demo
void runDemo();

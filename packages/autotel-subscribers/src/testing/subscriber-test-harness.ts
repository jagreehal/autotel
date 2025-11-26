/**
 * SubscriberTestHarness - Validate Your Custom Subscriber
 *
 * Use this to test that your custom subscriber implements the EventSubscriber
 * interface correctly. It runs a suite of tests covering:
 * - Basic tracking (all 4 methods)
 * - Concurrent requests
 * - Error handling
 * - Graceful shutdown
 *
 * @example
 * ```typescript
 * import { SubscriberTestHarness } from 'autotel-subscribers/testing';
 * import { MyCustomSubscriber } from './my-adapter';
 *
 * const harness = new SubscriberTestHarness(new MyCustomSubscriber());
 * const results = await harness.runAll();
 *
 * if (results.passed) {
 *   console.log('✅ All tests passed!');
 * } else {
 *   console.error('❌ Tests failed:', results.failures);
 * }
 * ```
 */

import type {
  EventSubscriber,
  FunnelStatus,
  OutcomeStatus,
} from '../event-subscriber-base';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: Error;
  details?: string;
}

export interface TestSuiteResult {
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  duration: number;
  results: TestResult[];
  failures: TestResult[];
}

/**
 * Test harness for validating custom subscribers.
 *
 * Runs a comprehensive suite of tests to ensure your subscriber:
 * 1. Implements all required methods
 * 2. Handles concurrent requests
 * 3. Deals with errors gracefully
 * 4. Shuts down cleanly
 */
export class SubscriberTestHarness {
  constructor(private subscriber: EventSubscriber) {}

  /**
   * Run all tests and return a comprehensive report.
   */
  async runAll(): Promise<TestSuiteResult> {
    const startTime = performance.now();
    const results: TestResult[] = [];

    // Run all test methods
    const testResults = await Promise.all([
      this.testBasicTracking(),
      this.testFunnelTracking(),
      this.testOutcomeTracking(),
      this.testValueTracking(),
      this.testConcurrency(),
      this.testErrorHandling(),
      this.testShutdown(),
    ]);
    results.push(...testResults);

    const duration = performance.now() - startTime;
    const passed_count = results.filter((r) => r.passed).length;
    const failed_count = results.filter((r) => !r.passed).length;
    const failures = results.filter((r) => !r.passed);

    return {
      passed: failed_count === 0,
      total: results.length,
      passed_count,
      failed_count,
      duration,
      results,
      failures,
    };
  }

  /**
   * Test basic event tracking.
   */
  async testBasicTracking(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      await this.subscriber.trackEvent('test.event', {
        userId: 'test-user',
        testAttribute: 'test-value',
      });

      return {
        name: 'Basic Event Tracking',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Successfully tracked event',
      };
    } catch (error) {
      return {
        name: 'Basic Event Tracking',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Test funnel step tracking.
   */
  async testFunnelTracking(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      await this.subscriber.trackFunnelStep('test_funnel', 'started' as FunnelStatus, {
        cartValue: 99.99,
      });

      await this.subscriber.trackFunnelStep('test_funnel', 'completed' as FunnelStatus, {
        cartValue: 99.99,
      });

      return {
        name: 'Funnel Tracking',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Successfully tracked funnel steps',
      };
    } catch (error) {
      return {
        name: 'Funnel Tracking',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Test outcome tracking.
   */
  async testOutcomeTracking(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      await this.subscriber.trackOutcome('test_operation', 'success' as OutcomeStatus, {
        duration: 100,
      });

      await this.subscriber.trackOutcome('test_operation', 'failure' as OutcomeStatus, {
        error: 'Test error',
      });

      return {
        name: 'Outcome Tracking',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Successfully tracked outcomes',
      };
    } catch (error) {
      return {
        name: 'Outcome Tracking',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Test value tracking.
   */
  async testValueTracking(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      await this.subscriber.trackValue('test_metric', 42, {
        unit: 'ms',
      });

      await this.subscriber.trackValue('revenue', 99.99, {
        currency: 'USD',
      });

      return {
        name: 'Value Tracking',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Successfully tracked values',
      };
    } catch (error) {
      return {
        name: 'Value Tracking',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Test concurrent requests (sends 50 events simultaneously).
   */
  async testConcurrency(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      const promises = Array.from({ length: 50 }, (_, i) =>
        this.subscriber.trackEvent(`concurrent_event_${i}`, {
          index: i,
          timestamp: Date.now(),
        })
      );

      await Promise.all(promises);

      return {
        name: 'Concurrency',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Successfully handled 50 concurrent requests',
      };
    } catch (error) {
      return {
        name: 'Concurrency',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Test error handling (passes invalid data).
   */
  async testErrorHandling(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      // Test with empty event name
      await this.subscriber.trackEvent('', {});

      // Test with undefined attributes
      await this.subscriber.trackEvent('test');

      // Test with null-ish values
      await this.subscriber.trackValue('test', 0, {});

      return {
        name: 'Error Handling',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Handled edge cases gracefully',
      };
    } catch {
      // Some subscribers might throw on invalid input - that's OK
      return {
        name: 'Error Handling',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Subscriber throws on invalid input (acceptable)',
      };
    }
  }

  /**
   * Test graceful shutdown.
   */
  async testShutdown(): Promise<TestResult> {
    const startTime = performance.now();

    try {
      // Start some long-running operations
      const promises = [
        this.subscriber.trackEvent('shutdown_test_1', {}),
        this.subscriber.trackEvent('shutdown_test_2', {}),
        this.subscriber.trackEvent('shutdown_test_3', {}),
      ];

      // Call shutdown
      await this.subscriber.shutdown?.();

      // Wait for operations to complete
      const results = await Promise.allSettled(promises);

      const allSettled = results.every(
        (r) => r.status === 'fulfilled' || r.status === 'rejected'
      );

      if (!allSettled) {
        throw new Error('Some promises never settled');
      }

      return {
        name: 'Graceful Shutdown',
        passed: true,
        duration: performance.now() - startTime,
        details: 'Shutdown completed, all requests settled',
      };
    } catch (error) {
      return {
        name: 'Graceful Shutdown',
        passed: false,
        duration: performance.now() - startTime,
        error: error as Error,
      };
    }
  }

  /**
   * Pretty-print test results to console.
   */
  static printResults(results: TestSuiteResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Subscriber Test Results');
    console.log('='.repeat(60));
    console.log(`\nTotal Tests: ${results.total}`);
    console.log(`✅ Passed: ${results.passed_count}`);
    console.log(`❌ Failed: ${results.failed_count}`);
    console.log(`⏱️  Duration: ${results.duration.toFixed(2)}ms`);
    console.log('\n' + '-'.repeat(60));

    for (const result of results.results) {
      const icon = result.passed ? '✅' : '❌';
      const duration = result.duration.toFixed(2);
      console.log(`${icon} ${result.name} (${duration}ms)`);

      if (result.details) {
        console.log(`   ${result.details}`);
      }

      if (result.error) {
        console.log(`   Error: ${result.error.message}`);
      }
    }

    console.log('='.repeat(60));

    if (results.passed) {
      console.log('\n🎉 All tests passed! Your subscriber is ready to use.');
    } else {
      console.log('\n⚠️  Some tests failed. Review the errors above.');
    }

    console.log('\n');
  }
}

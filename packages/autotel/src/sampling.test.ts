import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RandomSampler,
  AlwaysSampler,
  NeverSampler,
  AdaptiveSampler,
  UserIdSampler,
  CompositeSampler,
  FeatureFlagSampler,
  type SamplingContext,
} from './sampling';
import { type ILogger } from './logger';

describe('Sampling', () => {
  let mockLogger: ILogger;
  let context: SamplingContext;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    context = {
      operationName: 'test.operation',
      args: [{ userId: '123', email: 'test@example.com' }],
    };
  });

  describe('RandomSampler', () => {
    it('should throw error for invalid sample rates', () => {
      expect(() => new RandomSampler(-0.1)).toThrow();
      expect(() => new RandomSampler(1.1)).toThrow();
    });

    it('should sample at 100%', () => {
      const sampler = new RandomSampler(1);
      const results = Array.from({ length: 100 }, () =>
        sampler.shouldSample(context),
      );

      expect(results.every((r) => r === true)).toBe(true);
    });

    it('should never sample at 0%', () => {
      const sampler = new RandomSampler(0);
      const results = Array.from({ length: 100 }, () =>
        sampler.shouldSample(context),
      );

      expect(results.every((r) => r === false)).toBe(true);
    });

    it('should sample approximately at the specified rate', () => {
      const sampler = new RandomSampler(0.5);
      const results = Array.from({ length: 1000 }, () =>
        sampler.shouldSample(context),
      );

      const sampleCount = results.filter(Boolean).length;
      // Allow 10% margin of error
      expect(sampleCount).toBeGreaterThan(450);
      expect(sampleCount).toBeLessThan(550);
    });
  });

  describe('AlwaysSampler', () => {
    it('should always sample', () => {
      const sampler = new AlwaysSampler();
      const results = Array.from({ length: 100 }, () =>
        sampler.shouldSample(context),
      );

      expect(results.every((r) => r === true)).toBe(true);
    });
  });

  describe('NeverSampler', () => {
    it('should never sample', () => {
      const sampler = new NeverSampler();
      const results = Array.from({ length: 100 }, () =>
        sampler.shouldSample(context),
      );

      expect(results.every((r) => r === false)).toBe(true);
    });
  });

  describe('AdaptiveSampler', () => {
    it('should throw error for invalid baseline sample rate', () => {
      expect(
        () =>
          new AdaptiveSampler({
            baselineSampleRate: -0.1,
          }),
      ).toThrow();
    });

    it('should indicate it needs tail sampling', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0.1,
      });

      expect(sampler.needsTailSampling()).toBe(true);
    });

    it('should always create spans (optimistic sampling)', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0, // Even with 0% baseline
        logger: mockLogger,
      });

      // FIX: shouldSample now always returns true for tail sampling
      const result = sampler.shouldSample(context);
      expect(result).toBe(true);
    });

    it('should keep error traces even when baseline would drop them', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0, // 0% baseline sampling
        alwaysSampleErrors: true,
        logger: mockLogger,
      });

      // FIX: Span is created (shouldSample returns true)
      const shouldSample = sampler.shouldSample(context);
      expect(shouldSample).toBe(true);

      // Tail sampling keeps error traces
      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: false,
        duration: 100,
        error: new Error('Test error'),
      });

      expect(shouldKeep).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Adaptive sampling: Keeping error trace',
        expect.objectContaining({
          operation: 'test.operation',
          error: 'Test error',
        }),
      );
    });

    it('should keep slow traces even when baseline would drop them', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0, // 0% baseline sampling
        slowThresholdMs: 1000,
        alwaysSampleSlow: true,
        logger: mockLogger,
      });

      // FIX: Span is created (shouldSample returns true)
      const shouldSample = sampler.shouldSample(context);
      expect(shouldSample).toBe(true);

      // Tail sampling keeps slow traces
      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: true,
        duration: 1500, // > 1000ms threshold
      });

      expect(shouldKeep).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Adaptive sampling: Keeping slow trace',
        expect.objectContaining({
          operation: 'test.operation',
          duration: 1500,
        }),
      );
    });

    it('should drop fast successful traces when baseline sampling says no', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0, // 0% baseline
        slowThresholdMs: 1000,
        logger: mockLogger,
      });

      // Span is created optimistically
      const shouldSample = sampler.shouldSample(context);
      expect(shouldSample).toBe(true);

      // Tail sampling drops fast/successful traces
      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: true,
        duration: 100, // < 1000ms threshold
      });

      expect(shouldKeep).toBe(false);
    });

    it('should keep fast successful traces when baseline sampling says yes', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 1, // 100% baseline
        slowThresholdMs: 1000,
        logger: mockLogger,
      });

      const shouldSample = sampler.shouldSample(context);
      expect(shouldSample).toBe(true);

      // Baseline sampled it, so keep it
      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: true,
        duration: 100,
      });

      expect(shouldKeep).toBe(true);
    });

    it('should respect alwaysSampleErrors flag', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0,
        alwaysSampleErrors: false, // Don't force-sample errors
        logger: mockLogger,
      });

      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: false,
        duration: 100,
        error: new Error('Test error'),
      });

      // With alwaysSampleErrors=false and baseline=0, errors are dropped
      expect(shouldKeep).toBe(false);
    });

    it('should respect alwaysSampleSlow flag', () => {
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0,
        slowThresholdMs: 1000,
        alwaysSampleSlow: false, // Don't force-sample slow requests
        logger: mockLogger,
      });

      const shouldKeep = sampler.shouldKeepTrace(context, {
        success: true,
        duration: 1500,
      });

      // With alwaysSampleSlow=false and baseline=0, slow requests are dropped
      expect(shouldKeep).toBe(false);
    });
  });

  describe('UserIdSampler', () => {
    const extractUserId = (args: unknown[]) => {
      const firstArg = args[0] as { userId?: string };
      return firstArg?.userId;
    };

    it('should always sample specific users', () => {
      const sampler = new UserIdSampler({
        baselineSampleRate: 0,
        alwaysSampleUsers: ['vip_123'],
        extractUserId,
        logger: mockLogger,
      });

      const vipContext: SamplingContext = {
        operationName: 'test.operation',
        args: [{ userId: 'vip_123' }],
      };

      expect(sampler.shouldSample(vipContext)).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith('Sampling user request', {
        operation: 'test.operation',
        userId: 'vip_123',
      });
    });

    it('should use consistent per-user sampling', () => {
      const sampler = new UserIdSampler({
        baselineSampleRate: 0.5,
        extractUserId,
        logger: mockLogger,
      });

      const user123Context: SamplingContext = {
        operationName: 'test.operation',
        args: [{ userId: 'user_123' }],
      };

      // Same user should always get same result
      const result1 = sampler.shouldSample(user123Context);
      const result2 = sampler.shouldSample(user123Context);
      const result3 = sampler.shouldSample(user123Context);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should add and remove users from always-sample list', () => {
      const sampler = new UserIdSampler({
        baselineSampleRate: 0,
        extractUserId,
      });

      sampler.addAlwaysSampleUsers('user_1', 'user_2');

      const user1Context: SamplingContext = {
        operationName: 'test.operation',
        args: [{ userId: 'user_1' }],
      };

      expect(sampler.shouldSample(user1Context)).toBe(true);

      sampler.removeAlwaysSampleUsers('user_1');
      expect(sampler.shouldSample(user1Context)).toBe(false);
    });

    it('should fallback to random sampling when no user ID', () => {
      const sampler = new UserIdSampler({
        baselineSampleRate: 1,
        extractUserId: (args) => (args[0] as { userId?: string })?.userId,
      });

      const noUserContext: SamplingContext = {
        operationName: 'test.operation',
        args: [{}],
      };

      expect(sampler.shouldSample(noUserContext)).toBe(true);
    });
  });

  describe('CompositeSampler', () => {
    it('should throw error with no child samplers', () => {
      expect(() => new CompositeSampler([])).toThrow();
    });

    it('should sample if any child sampler returns true', () => {
      const sampler = new CompositeSampler([
        new NeverSampler(),
        new AlwaysSampler(),
        new NeverSampler(),
      ]);

      expect(sampler.shouldSample(context)).toBe(true);
    });

    it('should not sample if all child samplers return false', () => {
      const sampler = new CompositeSampler([
        new NeverSampler(),
        new NeverSampler(),
      ]);

      expect(sampler.shouldSample(context)).toBe(false);
    });
  });

  describe('FeatureFlagSampler', () => {
    const extractFlags = (
      args: unknown[],
      metadata?: Record<string, unknown>,
    ) => {
      const firstArg = args[0] as { flags?: string[] };
      return firstArg?.flags || (metadata?.featureFlags as string[]);
    };

    it('should always sample requests with monitored flags', () => {
      const sampler = new FeatureFlagSampler({
        baselineSampleRate: 0,
        alwaysSampleFlags: ['new_checkout', 'experimental_ui'],
        extractFlags,
        logger: mockLogger,
      });

      const flagContext: SamplingContext = {
        operationName: 'test.operation',
        args: [{ flags: ['new_checkout'] }],
      };

      expect(sampler.shouldSample(flagContext)).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sampling feature flag request',
        {
          operation: 'test.operation',
          flags: ['new_checkout'],
        },
      );
    });

    it('should use baseline sampling for non-monitored flags', () => {
      const sampler = new FeatureFlagSampler({
        baselineSampleRate: 0,
        alwaysSampleFlags: ['monitored_flag'],
        extractFlags,
      });

      const flagContext: SamplingContext = {
        operationName: 'test.operation',
        args: [{ flags: ['other_flag'] }],
      };

      expect(sampler.shouldSample(flagContext)).toBe(false);
    });

    it('should add and remove flags', () => {
      const sampler = new FeatureFlagSampler({
        baselineSampleRate: 0,
        extractFlags,
      });

      sampler.addAlwaysSampleFlags('flag_1', 'flag_2');

      const flag1Context: SamplingContext = {
        operationName: 'test.operation',
        args: [{ flags: ['flag_1'] }],
      };

      expect(sampler.shouldSample(flag1Context)).toBe(true);

      sampler.removeAlwaysSampleFlags('flag_1');
      expect(sampler.shouldSample(flag1Context)).toBe(false);
    });
  });

  describe('Real-world QA in Production scenarios', () => {
    it('should always capture failed email deliveries from article example', () => {
      // From article: "We set up another alert that let us know if our
      // email-sending microservice was unable to process a request"
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0.1, // 10% baseline
        alwaysSampleErrors: true, // Always capture failures
      });

      const emailContext: SamplingContext = {
        operationName: 'email.send',
        args: [{ to: 'school@example.com' }],
      };

      sampler.shouldSample(emailContext);

      // Email fails due to invalid address
      const shouldKeep = sampler.shouldKeepTrace(emailContext, {
        success: false,
        duration: 100,
        error: new Error('Invalid email address'),
      });

      expect(shouldKeep).toBe(true);
    });

    it('should always trace slow job applications from article example', () => {
      // From article: Monitor if teachers are able to submit applications
      const sampler = new AdaptiveSampler({
        baselineSampleRate: 0.05, // 5% baseline
        slowThresholdMs: 2000, // Slow if > 2s
        alwaysSampleSlow: true,
      });

      const applicationContext: SamplingContext = {
        operationName: 'application.submit',
        args: [{ jobId: '123', teacherId: '456' }],
      };

      sampler.shouldSample(applicationContext);

      // Application takes too long
      const shouldKeep = sampler.shouldKeepTrace(applicationContext, {
        success: true,
        duration: 3000, // > 2s threshold
      });

      expect(shouldKeep).toBe(true);
    });

    it('should always trace VIP users', () => {
      const extractUserId = (args: unknown[]) => {
        const firstArg = args[0] as { userId?: string };
        return firstArg?.userId;
      };

      const sampler = new UserIdSampler({
        baselineSampleRate: 0.01, // 1% of normal users
        alwaysSampleUsers: ['vip_school_123'], // Always trace VIP schools
        extractUserId,
      });

      const vipContext: SamplingContext = {
        operationName: 'application.receive',
        args: [{ userId: 'vip_school_123' }],
      };

      expect(sampler.shouldSample(vipContext)).toBe(true);
    });

    it('should always trace A/B test variants for correlation', () => {
      const extractFlags = (args: unknown[]) => {
        const firstArg = args[0] as { experimentFlags?: string[] };
        return firstArg?.experimentFlags;
      };

      const sampler = new FeatureFlagSampler({
        baselineSampleRate: 0.05,
        alwaysSampleFlags: ['new_application_form'], // Always trace experiment
        extractFlags,
      });

      const experimentContext: SamplingContext = {
        operationName: 'application.submit',
        args: [{ experimentFlags: ['new_application_form'] }],
      };

      expect(sampler.shouldSample(experimentContext)).toBe(true);
    });
  });
});

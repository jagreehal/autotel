import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Metric, getMetrics, resetMetrics } from './metric';
import { type ILogger } from './logger';
import { init } from './init';
import { configure } from './config';

describe('Metrics', () => {
  let mockLogger: ILogger;

  beforeEach(() => {
    resetMetrics();
    init({ service: 'test-app' });
    configure({
      meterName: 'test',
    });
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('trackEvent', () => {
    it('should track business events as metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackEvent('order.completed', {
        orderId: '123',
        amount: 99.99,
      });

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: 'order.completed',
          attributes: { orderId: '123', amount: 99.99 },
        },
        'Metric event tracked',
      );
    });

    it('should track events without attributes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackEvent('user.login');

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: 'user.login',
          attributes: undefined,
        },
        'Metric event tracked',
      );
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel progression as metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
      metrics.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 });

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          funnel: 'checkout',
          status: 'started',
          attributes: { cartValue: 99.99 },
        },
        'Funnel step tracked',
      );
    });

    it('should track funnel abandonment', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackFunnelStep('checkout', 'abandoned', { reason: 'timeout' });

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          funnel: 'checkout',
          status: 'abandoned',
          attributes: { reason: 'timeout' },
        },
        'Funnel step tracked',
      );
    });
  });

  describe('trackOutcome', () => {
    it('should track successful outcomes as metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('payment.process', 'success', {
        amount: 99.99,
      });

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          operation: 'payment.process',
          status: 'success',
          attributes: { amount: 99.99 },
        },
        'Outcome tracked',
      );
    });

    it('should track failed outcomes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('payment.process', 'failure', {
        error: 'insufficient_funds',
      });

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          operation: 'payment.process',
          status: 'failure',
          attributes: { error: 'insufficient_funds' },
        },
        'Outcome tracked',
      );
    });

    it('should track partial outcomes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('batch.process', 'partial', {
        successCount: 8,
        failureCount: 2,
      });

      // Pino-native: (extra, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          operation: 'batch.process',
          status: 'partial',
          attributes: { successCount: 8, failureCount: 2 },
        },
        'Outcome tracked',
      );
    });
  });

  describe('trackValue', () => {
    it('should track revenue metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackValue('order.revenue', 149.99, {
        currency: 'USD',
        productCategory: 'electronics',
      });

      // Pino-native: (extra, message)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {
          metric: 'order.revenue',
          value: 149.99,
          attributes: { currency: 'USD', productCategory: 'electronics' },
        },
        'Value metric tracked',
      );
    });

    it('should track processing time', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackValue('application.processing_time', 2500, {
        unit: 'ms',
      });

      // Pino-native: (extra, message)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {
          metric: 'application.processing_time',
          value: 2500,
          attributes: { unit: 'ms' },
        },
        'Value metric tracked',
      );
    });
  });

  describe('getMetrics', () => {
    it('should return singleton instance', () => {
      const metrics1 = getMetrics('test-service');
      const metrics2 = getMetrics('test-service');

      expect(metrics1).toBe(metrics2);
    });

    it('should return different instances for different services', () => {
      const metrics1 = getMetrics('service-1');
      const metrics2 = getMetrics('service-2');

      expect(metrics1).not.toBe(metrics2);
    });

    it('should reset instances', () => {
      const metrics1 = getMetrics('test-service');
      resetMetrics();
      const metrics2 = getMetrics('test-service');

      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('real-world usage example', () => {
    it('should track checkout flow', () => {
      const metrics = new Metric('checkout', { logger: mockLogger });

      // User starts checkout
      metrics.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });

      // Order completed
      metrics.trackEvent('order.completed', {
        orderId: 'ord_123',
        amount: 99.99,
      });
      metrics.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 });

      // Payment processed successfully
      metrics.trackOutcome('payment.process', 'success', {
        amount: 99.99,
      });

      // Track revenue
      metrics.trackValue('revenue', 99.99, { currency: 'USD' });

      expect(mockLogger.info).toHaveBeenCalledTimes(4);
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    });
  });
});

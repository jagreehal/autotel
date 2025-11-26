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

      expect(mockLogger.info).toHaveBeenCalledWith('Metric event tracked', {
        event: 'order.completed',
        attributes: { orderId: '123', amount: 99.99 },
      });
    });

    it('should track events without attributes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackEvent('user.login');

      expect(mockLogger.info).toHaveBeenCalledWith('Metric event tracked', {
        event: 'user.login',
        attributes: undefined,
      });
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel progression as metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
      metrics.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 });

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Funnel step tracked', {
        funnel: 'checkout',
        status: 'started',
        attributes: { cartValue: 99.99 },
      });
    });

    it('should track funnel abandonment', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackFunnelStep('checkout', 'abandoned', { reason: 'timeout' });

      expect(mockLogger.info).toHaveBeenCalledWith('Funnel step tracked', {
        funnel: 'checkout',
        status: 'abandoned',
        attributes: { reason: 'timeout' },
      });
    });
  });

  describe('trackOutcome', () => {
    it('should track successful outcomes as metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('payment.process', 'success', {
        amount: 99.99,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'payment.process',
        status: 'success',
        attributes: { amount: 99.99 },
      });
    });

    it('should track failed outcomes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('payment.process', 'failure', {
        error: 'insufficient_funds',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'payment.process',
        status: 'failure',
        attributes: { error: 'insufficient_funds' },
      });
    });

    it('should track partial outcomes', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackOutcome('batch.process', 'partial', {
        successCount: 8,
        failureCount: 2,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'batch.process',
        status: 'partial',
        attributes: { successCount: 8, failureCount: 2 },
      });
    });
  });

  describe('trackValue', () => {
    it('should track revenue metrics', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackValue('order.revenue', 149.99, {
        currency: 'USD',
        productCategory: 'electronics',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('Value metric tracked', {
        metric: 'order.revenue',
        value: 149.99,
        attributes: { currency: 'USD', productCategory: 'electronics' },
      });
    });

    it('should track processing time', () => {
      const metrics = new Metric('test-service', { logger: mockLogger });

      metrics.trackValue('application.processing_time', 2500, {
        unit: 'ms',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('Value metric tracked', {
        metric: 'application.processing_time',
        value: 2500,
        attributes: { unit: 'ms' },
      });
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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Event, getEvents, resetEvents } from './event';
import { type Logger } from './logger';
import { init } from './init';
import { shutdown } from './shutdown';
import { trace } from './functional';

describe('Events', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    resetEvents();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('trackEvent', () => {
    it('should track business events', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackEvent('application.submitted', {
        jobId: '123',
        userId: '456',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Event tracked', {
        event: 'application.submitted',
        attributes: { service: 'test-service', jobId: '123', userId: '456' },
      });
    });

    it('should track events without attributes', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackEvent('user.login');

      expect(mockLogger.info).toHaveBeenCalledWith('Event tracked', {
        event: 'user.login',
        attributes: { service: 'test-service' },
      });
    });
  });

  describe('trackFunnelStep', () => {
    it('should track funnel progression', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
      event.trackFunnelStep('checkout', 'completed', { cartValue: 99.99 });

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Funnel step tracked', {
        funnel: 'checkout',
        status: 'started',
        attributes: { service: 'test-service', cartValue: 99.99 },
      });
    });

    it('should track funnel abandonment', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackFunnelStep('checkout', 'abandoned', { reason: 'timeout' });

      expect(mockLogger.info).toHaveBeenCalledWith('Funnel step tracked', {
        funnel: 'checkout',
        status: 'abandoned',
        attributes: { service: 'test-service', reason: 'timeout' },
      });
    });
  });

  describe('trackOutcome', () => {
    it('should track successful outcomes', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackOutcome('email.delivery', 'success', {
        recipientType: 'school',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'email.delivery',
        status: 'success',
        attributes: { service: 'test-service', recipientType: 'school' },
      });
    });

    it('should track failed outcomes', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackOutcome('email.delivery', 'failure', {
        error: 'invalid_email',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'email.delivery',
        status: 'failure',
        attributes: { service: 'test-service', error: 'invalid_email' },
      });
    });

    it('should track partial outcomes', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackOutcome('batch.process', 'partial', {
        successCount: 8,
        failureCount: 2,
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Outcome tracked', {
        operation: 'batch.process',
        status: 'partial',
        attributes: {
          service: 'test-service',
          successCount: 8,
          failureCount: 2,
        },
      });
    });
  });

  describe('trackValue', () => {
    it('should track revenue metrics', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackValue('order.revenue', 149.99, {
        currency: 'USD',
        productCategory: 'electronics',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('Value tracked', {
        metric: 'order.revenue',
        value: 149.99,
        attributes: {
          service: 'test-service',
          metric: 'order.revenue',
          currency: 'USD',
          productCategory: 'electronics',
        },
      });
    });

    it('should track processing time', () => {
      const event = new Event('test-service', { logger: mockLogger });

      event.trackValue('application.processing_time', 2500, {
        unit: 'ms',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('Value tracked', {
        metric: 'application.processing_time',
        value: 2500,
        attributes: {
          service: 'test-service',
          metric: 'application.processing_time',
          unit: 'ms',
        },
      });
    });
  });

  describe('getEvents', () => {
    it('should return singleton instance', () => {
      const events1 = getEvents('test-service');
      const events2 = getEvents('test-service');

      expect(events1).toBe(events2);
    });

    it('should return different instances for different services', () => {
      const events1 = getEvents('service-1');
      const events2 = getEvents('service-2');

      expect(events1).not.toBe(events2);
    });

    it('should reset instances', () => {
      const events1 = getEvents('test-service');
      resetEvents();
      const events2 = getEvents('test-service');

      expect(events1).not.toBe(events2);
    });
  });

  describe('real-world usage example', () => {
    it('should track job application flow', () => {
      const event = new Event('job-application', {
        logger: mockLogger,
      });

      // User starts application
      event.trackFunnelStep('application', 'started', { jobId: '123' });

      // User submits application
      event.trackEvent('application.submitted', {
        jobId: '123',
        userId: '456',
      });
      event.trackFunnelStep('application', 'completed', { jobId: '123' });

      // Email sent successfully
      event.trackOutcome('email.sent', 'success', {
        recipientType: 'school',
        jobId: '123',
      });

      expect(mockLogger.info).toHaveBeenCalledTimes(4);
    });

    it('should track email delivery failures', () => {
      const event = new Event('email-service', { logger: mockLogger });

      // Failed email delivery
      event.trackOutcome('email.delivery', 'failure', {
        error: 'invalid_email',
        recipientEmail: 'redacted',
      });

      // Track event for alerting
      event.trackEvent('email.bounce', {
        bounceType: 'permanent',
      });

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('automatic telemetry context enrichment', () => {
    beforeEach(() => {
      resetEvents();
    });

    afterEach(async () => {
      await shutdown();
    });

    // Test without config first (before any init() is called)
    it('should still work without config (graceful degradation)', () => {
      // Don't initialize - no config available
      const event = new Event('test-service', { logger: mockLogger });

      event.trackEvent('user.login');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: {
            service: 'test-service',
            // No version/environment - gracefully omitted
          },
        }),
      );
    });

    it('should auto-capture resource attributes (service.version, deployment.environment)', () => {
      // Initialize with config
      init({
        service: 'test-service',
        version: '2.1.0',
        environment: 'production',
      });

      const event = new Event('test-service', { logger: mockLogger });

      event.trackEvent('user.signup', { userId: '123' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            service: 'test-service',
            'service.version': '2.1.0',
            'deployment.environment': 'production',
            userId: '123',
          }),
        }),
      );
    });

    it('should auto-capture trace context (traceId, spanId, correlationId) when inside a trace', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const tracedOperation = trace('test.operation', async () => {
        event.trackEvent('operation.started', { step: 1 });
      });

      await tracedOperation();

      const capturedCall = (mockLogger.info as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const attributes = capturedCall[1].attributes;

      expect(attributes).toHaveProperty('traceId');
      expect(attributes).toHaveProperty('spanId');
      expect(attributes).toHaveProperty('correlationId');
      expect(typeof attributes.traceId).toBe('string');
      expect(typeof attributes.spanId).toBe('string');
      expect(typeof attributes.correlationId).toBe('string');
      // Correlation ID should be first 16 chars of traceId
      expect(attributes.correlationId).toBe(attributes.traceId.slice(0, 16));
    });

    it('should enrich trackFunnelStep with telemetry context', async () => {
      init({
        service: 'test-service',
        version: '1.5.0',
        environment: 'staging',
      });

      const event = new Event('test-service', { logger: mockLogger });

      const tracedOperation = trace('checkout.flow', async () => {
        event.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
      });

      await tracedOperation();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Funnel step tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            service: 'test-service',
            'service.version': '1.5.0',
            'deployment.environment': 'staging',
            cartValue: 99.99,
            traceId: expect.any(String),
            spanId: expect.any(String),
            correlationId: expect.any(String),
          }),
        }),
      );
    });

    it('should enrich trackOutcome with telemetry context', async () => {
      init({
        service: 'test-service',
        version: '3.0.0',
        environment: 'development',
      });

      const event = new Event('test-service', { logger: mockLogger });

      const tracedOperation = trace('email.send', async () => {
        event.trackOutcome('email.delivery', 'success', {
          recipientType: 'user',
        });
      });

      await tracedOperation();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Outcome tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            service: 'test-service',
            'service.version': '3.0.0',
            'deployment.environment': 'development',
            recipientType: 'user',
            traceId: expect.any(String),
            spanId: expect.any(String),
            correlationId: expect.any(String),
          }),
        }),
      );
    });

    it('should enrich trackValue with telemetry context', async () => {
      init({
        service: 'test-service',
        version: '4.2.1',
        environment: 'production',
      });

      const event = new Event('test-service', { logger: mockLogger });

      const tracedOperation = trace('order.process', async () => {
        event.trackValue('order.revenue', 149.99, { currency: 'USD' });
      });

      await tracedOperation();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Value tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            service: 'test-service',
            metric: 'order.revenue',
            'service.version': '4.2.1',
            'deployment.environment': 'production',
            currency: 'USD',
            traceId: expect.any(String),
            spanId: expect.any(String),
            correlationId: expect.any(String),
          }),
        }),
      );
    });

    it('should still work outside a trace (no trace context)', () => {
      init({
        service: 'test-service',
        version: '1.0.0',
        environment: 'test',
      });

      const event = new Event('test-service', { logger: mockLogger });

      // Call outside a trace
      event.trackEvent('background.job.completed', { jobId: 'job-123' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: {
            service: 'test-service',
            'service.version': '1.0.0',
            'deployment.environment': 'test',
            jobId: 'job-123',
            // No traceId/spanId/correlationId - gracefully omitted
          },
        }),
      );
    });
  });

  describe('automatic operation context enrichment', () => {
    beforeEach(() => {
      resetEvents();
    });

    afterEach(async () => {
      await shutdown();
    });

    it('should auto-capture operation.name when inside trace() with string name', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const operation = trace('user.create', async () => {
        event.trackEvent('user.created', { userId: '123' });
      });

      await operation();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'user.create',
            userId: '123',
          }),
        }),
      );
    });

    it('should auto-capture operation.name when inside trace() with named function', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const createUser = trace(async function createUser() {
        event.trackEvent('user.created', { userId: '456' });
      });

      await createUser();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            // Function name might be inferred with slight variations (e.g., 'createUser2')
            // The important thing is that operation.name is auto-captured
            'operation.name': expect.stringMatching(/createUser/),
            userId: '456',
          }),
        }),
      );
    });

    it('should reliably infer function names in both factory and non-factory patterns', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      // Test 1: Named function declaration (non-factory pattern)
      // Should infer name from function declaration
      const updateUser = trace(async function updateUser(userId: string) {
        event.trackEvent('user.updated', { userId });
      });
      await updateUser('user-123');

      // Test 2: Named function with factory pattern (ctx parameter)
      // Explicit name should take precedence
      const deleteUser = trace(
        'user.delete',
        (ctx) =>
          async function deleteUser(userId: string) {
            ctx.setAttribute('user.id', userId);
            event.trackEvent('user.deleted', { userId });
          },
      );
      await deleteUser('user-456');

      // Test 3: Named function in factory pattern (should infer inner function name)
      const createOrder = trace(
        (ctx) =>
          async function createOrder(orderId: string) {
            ctx.setAttribute('order.id', orderId);
            event.trackEvent('order.created', { orderId });
          },
      );
      await createOrder('order-789');

      // Verify all operations captured correct names
      const calls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;

      // First call: updateUser - should infer from named function declaration
      expect(calls[0][1].attributes['operation.name']).toMatch(/updateUser/);

      // Second call: user.delete - explicit name takes precedence
      expect(calls[1][1].attributes['operation.name']).toBe('user.delete');

      // Third call: createOrder - should infer from inner named function in factory pattern
      expect(calls[2][1].attributes['operation.name']).toMatch(/createOrder/);
    });

    it('should auto-capture operation.name in nested spans', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });
      const { span } = await import('./functional');

      const operation = trace('order.process', async () => {
        span({ name: 'order.validate' }, () => {
          // Should capture the innermost operation name
          event.trackEvent('order.validated', { orderId: 'ord_123' });
        });
      });

      await operation();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'order.validate',
            orderId: 'ord_123',
          }),
        }),
      );
    });

    it('should auto-capture operation.name in trackFunnelStep', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const checkout = trace('checkout.flow', async () => {
        event.trackFunnelStep('checkout', 'started', {
          cartValue: 99.99,
        });
      });

      await checkout();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Funnel step tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'checkout.flow',
            cartValue: 99.99,
          }),
        }),
      );
    });

    it('should auto-capture operation.name in trackOutcome', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const sendEmail = trace('email.send', async () => {
        event.trackOutcome('email.delivery', 'success', {
          recipientType: 'user',
        });
      });

      await sendEmail();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Outcome tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'email.send',
            recipientType: 'user',
          }),
        }),
      );
    });

    it('should auto-capture operation.name in trackValue', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const processOrder = trace('order.process', async () => {
        event.trackValue('order.revenue', 149.99, { currency: 'USD' });
      });

      await processOrder();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Value tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'order.process',
            currency: 'USD',
          }),
        }),
      );
    });

    it('should handle missing operation.name gracefully (outside trace)', () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      // Call outside any trace
      event.trackEvent('background.job', { jobId: 'job-123' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: {
            service: 'test-service',
            'service.version': undefined,
            'deployment.environment': undefined,
            jobId: 'job-123',
            // No operation.name - gracefully omitted
          },
        }),
      );
    });

    it('should capture parent operation.name when not in nested span', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const parentOperation = trace('parent.operation', async () => {
        // Track event in parent context (not in a nested span)
        event.trackEvent('parent.event', { step: 1 });

        // Then create a nested span
        const { span } = await import('./functional');
        span({ name: 'child.operation' }, () => {
          event.trackEvent('child.event', { step: 2 });
        });
      });

      await parentOperation();

      // Check parent event has parent operation name
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'parent.operation',
            step: 1,
          }),
        }),
      );

      // Check child event has child operation name
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'child.operation',
            step: 2,
          }),
        }),
      );
    });

    it('should work with trace() factory pattern', async () => {
      init({ service: 'test-service' });

      const event = new Event('test-service', { logger: mockLogger });

      const operation = trace('factory.operation', (ctx) => async () => {
        ctx.setAttribute('custom', 'attribute');
        event.trackEvent('factory.event', { data: 'test' });
      });

      await operation();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Event tracked',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'operation.name': 'factory.operation',
            data: 'test',
          }),
        }),
      );
    });
  });
});

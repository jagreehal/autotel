import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEdgeLogger, runWithLogLevel, getActiveLogLevel } from './logger';
import { trace } from '@opentelemetry/api';

describe('Edge Logger', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let consoleInfoSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  describe('createEdgeLogger', () => {
    it('should create a logger with service name', () => {
      const logger = createEdgeLogger('test-service');
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should log info messages with service name', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('test message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'info',
        service: 'test-service',
        msg: 'test message',
        key: 'value',
      });
      expect(logOutput.timestamp).toBeDefined();
    });

    it('should log error messages', () => {
      const logger = createEdgeLogger('test-service');
      const error = new Error('test error');
      logger.error('error occurred', error);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'error occurred',
        error: 'test error',
      });
      expect(logOutput.stack).toBeDefined();
    });

    it('should log warning messages', () => {
      const logger = createEdgeLogger('test-service');
      logger.warn('warning message', { reason: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'warn',
        service: 'test-service',
        msg: 'warning message',
        reason: 'test',
      });
    });

    it('should log debug messages when level is set to debug', () => {
      const logger = createEdgeLogger('test-service', { level: 'debug' });
      logger.debug('debug message', { detail: 'verbose' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'debug',
        service: 'test-service',
        msg: 'debug message',
        detail: 'verbose',
      });
    });

    it('should not log debug messages when level is info (default)', () => {
      const logger = createEdgeLogger('test-service');
      logger.debug('debug message', { detail: 'verbose' });

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should include trace context when available', () => {
      const logger = createEdgeLogger('test-service');

      // Create a mock tracer and span
      const mockSpan = {
        spanContext: () => ({
          traceId: 'test-trace-id-16chars',
          spanId: 'test-span-id',
          traceFlags: 1,
        }),
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
        isRecording: () => true,
        updateName: vi.fn(),
        addEvent: vi.fn(),
        setAttributes: vi.fn(),
      };

      // Mock trace.getActiveSpan to return our span
      const getActiveSpanSpy = vi
        .spyOn(trace, 'getActiveSpan')
        .mockReturnValue(mockSpan as any);

      logger.info('message with trace');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'info',
        service: 'test-service',
        msg: 'message with trace',
        traceId: 'test-trace-id-16chars',
        spanId: 'test-span-id',
        correlationId: 'test-trace-id-16',
      });

      getActiveSpanSpy.mockRestore();
    });

    it('should handle non-Error objects', () => {
      const logger = createEdgeLogger('test-service');
      const errorObject = { message: 'simple error' };
      logger.error('error occurred', errorObject);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'error occurred',
        error: '[object Object]',
      });
    });

    it('should handle null and undefined context gracefully', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('message with null', null as any);
      logger.info('message with undefined', undefined as any);

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);

      const log1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const log2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);

      expect(log1.msg).toBe('message with null');
      expect(log2.msg).toBe('message with undefined');
    });

    it('should accept a single context object', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('message', { a: 1, b: 2, c: 3 });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'info',
        msg: 'message',
        a: 1,
        b: 2,
        c: 3,
      });
    });

    it('should preserve timestamp format', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('test');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });
  });

  describe('Pretty mode', () => {
    it('should format logs in pretty mode', () => {
      const logger = createEdgeLogger('test-service', { pretty: true });
      logger.info('pretty message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = consoleLogSpy.mock.calls[0][0];

      // In pretty mode, output is a formatted string, not JSON
      expect(typeof logOutput).toBe('string');
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('test-service');
      expect(logOutput).toContain('pretty message');
    });

    it('should format errors in pretty mode', () => {
      const logger = createEdgeLogger('test-service', { pretty: true });
      const error = new Error('test error');
      logger.error('error occurred', error);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = consoleLogSpy.mock.calls[0][0];

      expect(typeof logOutput).toBe('string');
      expect(logOutput).toContain('ERROR');
      expect(logOutput).toContain('test-service');
      expect(logOutput).toContain('error occurred');
    });
  });

  describe('Edge cases', () => {
    it('should throw on circular references in context', () => {
      const logger = createEdgeLogger('test-service');
      const circular: any = { a: 1 };
      circular.self = circular;

      // JSON.stringify will throw on circular references
      expect(() => {
        logger.info('circular', circular);
      }).toThrow(/circular/i);
    });

    it('should handle very long messages', () => {
      const logger = createEdgeLogger('test-service');
      const longMessage = 'a'.repeat(10_000);

      logger.info(longMessage);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const logger = createEdgeLogger('test-service');
      const specialMessage = 'Hello\nWorld\t"quoted"\r\nNew Line';

      logger.info(specialMessage);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe(specialMessage);
    });
  });

  describe('child()', () => {
    it('should create a child logger with merged bindings', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ requestId: 'req-123' });

      child.info('child message', { extra: 'data' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'info',
        service: 'test-service',
        msg: 'child message',
        requestId: 'req-123',
        extra: 'data',
      });
    });

    it('should merge parent bindings with child bindings', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ requestId: 'req-123' });
      const grandchild = child.child({ userId: 'user-456' });

      grandchild.info('deep message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        msg: 'deep message',
        requestId: 'req-123',
        userId: 'user-456',
      });
    });

    it('should allow child attrs to override bindings', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ env: 'staging' });

      child.info('override', { env: 'production' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      // Call-time attrs override bindings
      expect(logOutput.env).toBe('production');
    });

    it('should return an EdgeLogger from child()', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ key: 'val' });

      expect(child.info).toBeDefined();
      expect(child.error).toBeDefined();
      expect(child.warn).toBeDefined();
      expect(child.debug).toBeDefined();
      expect(child.child).toBeDefined();
    });

    it('should chain child() calls', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ a: 1 }).child({ b: 2 }).child({ c: 3 });

      child.info('chained');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({ a: 1, b: 2, c: 3 });
    });

    it('should not affect parent logger', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ childOnly: 'yes' });

      logger.info('parent message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.childOnly).toBeUndefined();
    });

    it('should include child bindings in pretty mode', () => {
      const logger = createEdgeLogger('test-service', { pretty: true });
      const child = logger.child({ requestId: 'req-123' });

      child.info('pretty child', { extra: 'data' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      expect(consoleLogSpy.mock.calls[0][1]).toMatchObject({
        requestId: 'req-123',
        extra: 'data',
      });
    });
  });

  describe('Dynamic log level control', () => {
    it('should override log level via runWithLogLevel', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });

      // Normal behavior: debug filtered out
      logger.debug('outside context');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      // Inside debug context: debug logged
      runWithLogLevel('debug', () => {
        logger.debug('inside debug context');
      });
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      // Back to normal: debug filtered out again
      logger.debug('outside context again');
      expect(consoleLogSpy).toHaveBeenCalledOnce();
    });

    it('should support none level to temporarily disable logging', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });

      logger.info('before none');
      const callsBeforeNone = consoleLogSpy.mock.calls.length;

      runWithLogLevel('none', () => {
        logger.info('inside none context');
        logger.error('even errors suppressed');
      });
      expect(consoleLogSpy.mock.calls.length).toBe(callsBeforeNone); // No new logs

      logger.info('after none');
      expect(consoleLogSpy.mock.calls.length).toBe(callsBeforeNone + 1);
    });

    it('should return value from callback', () => {
      const result = runWithLogLevel('debug', () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it('should propagate async results', async () => {
      const result = await runWithLogLevel('debug', async () => {
        return 'async value';
      });
      expect(result).toBe('async value');
    });

    it('should allow raising log level temporarily', () => {
      const logger = createEdgeLogger('test-service', { level: 'error' });

      logger.info('normal info');
      logger.warn('normal warn');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      runWithLogLevel('info', () => {
        logger.info('temporary info');
        logger.warn('temporary warn');
      });
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should isolate log level changes to context', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });

      runWithLogLevel('debug', () => {
        logger.debug('context 1 - debug');
        expect(consoleLogSpy).toHaveBeenCalledOnce();
      });

      runWithLogLevel('error', () => {
        logger.info('context 2 - info should be filtered');
        expect(consoleLogSpy).toHaveBeenCalledOnce(); // No new logs
      });
    });
  });

  describe('getActiveLogLevel', () => {
    it('should return undefined when no active level', () => {
      expect(getActiveLogLevel()).toBeUndefined();
    });

    it('should return active level inside runWithLogLevel', () => {
      runWithLogLevel('debug', () => {
        expect(getActiveLogLevel()).toBe('debug');
      });

      runWithLogLevel('error', () => {
        expect(getActiveLogLevel()).toBe('error');
      });
    });

    it('should reset after runWithLogLevel completes', () => {
      runWithLogLevel('debug', () => {
        expect(getActiveLogLevel()).toBe('debug');
      });
      expect(getActiveLogLevel()).toBeUndefined();
    });
  });
});

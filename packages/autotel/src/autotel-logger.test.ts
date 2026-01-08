import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBuiltinLogger,
  autotelLogger,
  runWithLogLevel,
  getActiveLogLevel,
  getTraceContext,
} from './autotel-logger';
import { trace } from '@opentelemetry/api';

describe('Built-in Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('createBuiltinLogger', () => {
    it('should create a logger with service name', () => {
      const logger = createBuiltinLogger('test-service');
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should log info messages with service name', () => {
      const logger = createBuiltinLogger('test-service');
      logger.info({ key: 'value' }, 'test message');

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

    it('should log error messages with Error object', () => {
      const logger = createBuiltinLogger('test-service');
      const error = new Error('test error');
      logger.error({ err: error }, 'error occurred');

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

    it('should log error messages without Error object', () => {
      const logger = createBuiltinLogger('test-service');
      logger.error({}, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'error occurred',
      });
      expect(logOutput.error).toBeUndefined();
    });

    it('should log warning messages', () => {
      const logger = createBuiltinLogger('test-service');
      logger.warn({ reason: 'test' }, 'warning message');

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
      const logger = createBuiltinLogger('test-service', { level: 'debug' });
      logger.debug({ detail: 'verbose' }, 'debug message');

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
      const logger = createBuiltinLogger('test-service');
      logger.debug({ detail: 'verbose' }, 'debug message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should include trace context when available', () => {
      const logger = createBuiltinLogger('test-service');

      // Create a mock span
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

      logger.info({}, 'message with trace');

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

    it('should handle non-Error objects in error() as extra context', () => {
      const logger = createBuiltinLogger('test-service');
      const errorContext = { code: 'ERR_SIMPLE', details: 'simple error' };
      // Pino style: (extra, message) - extra is preserved as structured context
      logger.error(errorContext, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'error occurred',
        code: 'ERR_SIMPLE',
        details: 'simple error',
      });
    });

    it('should accept a single context object', () => {
      const logger = createBuiltinLogger('test-service');
      logger.info({ a: 1, b: 2, c: 3 }, 'message');

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
      const logger = createBuiltinLogger('test-service');
      logger.info({}, 'test');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('should support string-only calls (Pino-style)', () => {
      const logger = createBuiltinLogger('test-service');
      logger.info('simple message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 'info',
        service: 'test-service',
        msg: 'simple message',
      });
    });

    it('should auto-swap legacy Winston-style (message, metadata) to preserve data', () => {
      const logger = createBuiltinLogger('test-service');
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      // Legacy Winston-style: (message, metadata)
      // @ts-expect-error - testing legacy pattern
      logger.info('User created', { userId: '123', action: 'create' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      // Metadata should be preserved (auto-swapped)
      expect(logOutput).toMatchObject({
        level: 'info',
        service: 'test-service',
        msg: 'User created',
        userId: '123',
        action: 'create',
      });

      // Warning should be logged in development
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain(
        'Legacy logger pattern',
      );

      consoleWarnSpy.mockRestore();
    });

    it('should auto-swap legacy Winston-style for error() and preserve err object', () => {
      const logger = createBuiltinLogger('test-service');
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const error = new Error('test error');

      // Legacy Winston-style: (message, { err })
      // @ts-expect-error - testing legacy pattern
      logger.error('Operation failed', { err: error, context: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      // Metadata should be preserved and err should be extracted
      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'Operation failed',
        error: 'test error',
        context: 'test',
      });
      expect(logOutput.stack).toBeDefined();

      consoleWarnSpy.mockRestore();
    });

    it('should auto-swap legacy logger.error(message, error) pattern', () => {
      const logger = createBuiltinLogger('test-service');
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const error = new Error('database connection failed');

      // Very common legacy pattern: logger.error('msg', error)
      // @ts-expect-error - testing legacy pattern
      logger.error('Operation failed', error);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      // Error should be preserved with stack trace
      expect(logOutput).toMatchObject({
        level: 'error',
        service: 'test-service',
        msg: 'Operation failed',
        error: 'database connection failed',
        name: 'Error',
      });
      expect(logOutput.stack).toBeDefined();
      expect(logOutput.stack).toContain('Error: database connection failed');

      // Warning should be logged in development
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain(
        "logger.error('message', error)",
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Pretty mode', () => {
    it('should format logs in pretty mode', () => {
      const logger = createBuiltinLogger('test-service', { pretty: true });
      logger.info({ key: 'value' }, 'pretty message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = consoleLogSpy.mock.calls[0][0];

      // In pretty mode, output is a formatted string, not JSON
      expect(typeof logOutput).toBe('string');
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('test-service');
      expect(logOutput).toContain('pretty message');
    });

    it('should format errors in pretty mode', () => {
      const logger = createBuiltinLogger('test-service', { pretty: true });
      const error = new Error('test error');
      logger.error({ err: error }, 'error occurred');

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
      const logger = createBuiltinLogger('test-service');
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      // JSON.stringify will throw on circular references
      expect(() => {
        logger.info(circular, 'circular');
      }).toThrow(/circular/i);
    });

    it('should handle very long messages', () => {
      const logger = createBuiltinLogger('test-service');
      const longMessage = 'a'.repeat(10_000);

      logger.info({}, longMessage);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const logger = createBuiltinLogger('test-service');
      const specialMessage = 'Hello\nWorld\t"quoted"\r\nNew Line';

      logger.info({}, specialMessage);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe(specialMessage);
    });
  });

  describe('Dynamic log level control', () => {
    it('should override log level via runWithLogLevel', () => {
      const logger = createBuiltinLogger('test-service', { level: 'info' });

      // Normal behavior: debug filtered out
      logger.debug({}, 'outside context');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      // Inside debug context: debug logged
      runWithLogLevel('debug', () => {
        logger.debug({}, 'inside debug context');
      });
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      // Back to normal: debug filtered out again
      logger.debug({}, 'outside context again');
      expect(consoleLogSpy).toHaveBeenCalledOnce();
    });

    it('should support none level to temporarily disable logging', () => {
      const logger = createBuiltinLogger('test-service', { level: 'info' });

      logger.info({}, 'before none');
      const callsBeforeNone = consoleLogSpy.mock.calls.length;

      runWithLogLevel('none', () => {
        logger.info({}, 'inside none context');
        logger.error({}, 'even errors suppressed');
      });
      expect(consoleLogSpy.mock.calls.length).toBe(callsBeforeNone); // No new logs

      logger.info({}, 'after none');
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
      const logger = createBuiltinLogger('test-service', { level: 'error' });

      logger.info({}, 'normal info');
      logger.warn({}, 'normal warn');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      runWithLogLevel('info', () => {
        logger.info({}, 'temporary info');
        logger.warn({}, 'temporary warn');
      });
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should isolate log level changes to context', () => {
      const logger = createBuiltinLogger('test-service', { level: 'info' });

      runWithLogLevel('debug', () => {
        logger.debug({}, 'context 1 - debug');
        expect(consoleLogSpy).toHaveBeenCalledOnce();
      });

      runWithLogLevel('error', () => {
        logger.info({}, 'context 2 - info should be filtered');
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

  describe('getTraceContext', () => {
    it('should return null when no active span', () => {
      expect(getTraceContext()).toBeNull();
    });

    it('should return trace context when span is active', () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: 'abcdef1234567890abcdef1234567890',
          spanId: 'abcdef1234567890',
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

      const getActiveSpanSpy = vi
        .spyOn(trace, 'getActiveSpan')
        .mockReturnValue(mockSpan as any);

      const ctx = getTraceContext();

      expect(ctx).toEqual({
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: 'abcdef1234567890',
        correlationId: 'abcdef1234567890', // First 16 chars of traceId
      });

      getActiveSpanSpy.mockRestore();
    });
  });

  describe('autotelLogger', () => {
    it('should create a logger with default service name', () => {
      const logger = autotelLogger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should create a logger with custom options', () => {
      const logger = autotelLogger({
        service: 'custom-service',
        level: 'debug',
        pretty: false,
      });
      logger.info({}, 'test message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.service).toBe('custom-service');
    });

    it('should use default service name "app" when not provided', () => {
      const logger = autotelLogger();
      logger.info({}, 'test');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.service).toBe('app');
    });
  });
});

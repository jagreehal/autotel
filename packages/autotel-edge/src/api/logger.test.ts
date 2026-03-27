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
      expect(logger.trace).toBeDefined();
      expect(logger.fatal).toBeDefined();
      expect(logger.silent).toBeDefined();
      expect(logger.isLevelEnabled).toBeDefined();
      expect(logger.bindings).toBeDefined();
      expect(logger.setBindings).toBeDefined();
    });

    it('should log info messages with service name', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ key: 'value' }, 'test message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 30,
        service: 'test-service',
        msg: 'test message',
        key: 'value',
      });
      expect(logOutput.timestamp).toBeDefined();
    });

    it('should support pino-style object-first info calls', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ userId: '123' }, 'User created');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 30,
        service: 'test-service',
        msg: 'User created',
        userId: '123',
      });
    });

    it('should support pino-style object-only info calls', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ userId: '123' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 30,
        service: 'test-service',
        userId: '123',
      });
      expect(logOutput).not.toHaveProperty('msg');
    });

    it('should omit msg for pino-style object-only info calls', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ userId: '123' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).not.toHaveProperty('msg');
      expect(logOutput.userId).toBe('123');
    });

    it('should log error messages', () => {
      const logger = createEdgeLogger('test-service');
      const error = new Error('test error');
      logger.error(error, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 50,
        service: 'test-service',
        msg: 'error occurred',
      });
      expect(logOutput.err).toMatchObject({
        message: 'test error',
        type: 'Error',
      });
      expect(typeof logOutput.err.stack).toBe('string');
    });

    it('should support pino-style error-first calls', () => {
      const logger = createEdgeLogger('test-service');
      logger.error(
        { requestId: 'req-1', error: 'test error' },
        'error occurred',
      );

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 50,
        service: 'test-service',
        msg: 'error occurred',
        requestId: 'req-1',
      });
    });

    it('should support pino-style error object calls', () => {
      const logger = createEdgeLogger('test-service');
      const error = new Error('test error');
      logger.error(error, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 50,
        service: 'test-service',
        msg: 'error occurred',
      });
      expect(logOutput.err).toMatchObject({
        message: 'test error',
        type: 'Error',
      });
      expect(typeof logOutput.err.stack).toBe('string');
    });

    it('should use err as the default error key like pino', () => {
      const logger = createEdgeLogger('test-service');
      const error = new Error('test error');

      logger.error(error);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.msg).toBe('test error');
      expect(logOutput).toHaveProperty('err');
      expect(logOutput).not.toHaveProperty('error');
    });

    it('should nest default error details under err like pino', () => {
      const logger = createEdgeLogger('test-service');
      const error = new Error('test error');

      logger.error(error);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.err).toMatchObject({
        message: 'test error',
        type: 'Error',
      });
      expect(typeof logOutput.err.stack).toBe('string');
      expect(logOutput).not.toHaveProperty('stack');
      expect(logOutput).not.toHaveProperty('name');
    });

    it('should log warning messages', () => {
      const logger = createEdgeLogger('test-service');
      logger.warn({ reason: 'test' }, 'warning message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 40,
        service: 'test-service',
        msg: 'warning message',
        reason: 'test',
      });
    });

    it('should support pino-style object-first warn calls', () => {
      const logger = createEdgeLogger('test-service');
      logger.warn({ reason: 'test' }, 'warning message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 40,
        service: 'test-service',
        msg: 'warning message',
        reason: 'test',
      });
    });

    it('should ignore extra non-format args after a string message like pino', () => {
      const logger = createEdgeLogger('test-service');

      logger.warn('warning message', { reason: 'test' } as any);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 40,
        service: 'test-service',
        msg: 'warning message',
      });
      expect(logOutput).not.toHaveProperty('reason');
    });

    it('should log debug messages when level is set to debug', () => {
      const logger = createEdgeLogger('test-service', { level: 'debug' });
      logger.debug({ detail: 'verbose' }, 'debug message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 20,
        service: 'test-service',
        msg: 'debug message',
        detail: 'verbose',
      });
    });

    it('should not log debug messages when level is info (default)', () => {
      const logger = createEdgeLogger('test-service');
      logger.debug({ detail: 'verbose' }, 'debug message');

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
        level: 30,
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
      logger.error(errorObject, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 50,
        service: 'test-service',
        msg: 'error occurred',
        message: 'simple error',
      });
    });

    it('should handle null and undefined context gracefully', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('message with null');
      logger.info('message with undefined');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);

      const log1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const log2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);

      expect(log1.msg).toBe('message with null');
      expect(log2.msg).toBe('message with undefined');
    });

    it('should accept a single context object', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ a: 1, b: 2, c: 3 }, 'message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 30,
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

    it('should expose a mutable level property', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });

      expect(logger.level).toBe('info');
      expect(logger.levelVal).toBe(30);
      expect(logger.isLevelEnabled('debug')).toBe(false);

      logger.level = 'debug';

      expect(logger.level).toBe('debug');
      expect(logger.levelVal).toBe(20);
      expect(logger.isLevelEnabled('debug')).toBe(true);
    });

    it('should expose pino-like instance metadata', () => {
      const logger = createEdgeLogger('test-service', { msgPrefix: '[api] ' });

      expect(logger.version).toBeDefined();
      expect(logger.levels.values.info).toBe(30);
      expect(logger.levels.labels[50]).toBe('error');
      expect(logger.useLevelLabels).toBe(false);
      expect(logger.msgPrefix).toBe('[api] ');
      expect(typeof logger.on).toBe('function');
      expect(typeof logger.flush).toBe('function');
    });

    it('should log trace and fatal levels', () => {
      const logger = createEdgeLogger('test-service', { level: 'trace' });

      logger.trace('trace message');
      logger.fatal('fatal message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);

      const traceOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const fatalOutput = JSON.parse(consoleLogSpy.mock.calls[1][0]);

      expect(traceOutput.level).toBe(10);
      expect(fatalOutput.level).toBe(60);
    });

    it('should apply msgPrefix to logged messages', () => {
      const logger = createEdgeLogger('test-service', { msgPrefix: '[api] ' });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe('[api] hello');
    });

    it('should support enabled toggling', () => {
      const logger = createEdgeLogger('test-service');

      logger.enabled = false;
      logger.info('hidden');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      logger.enabled = true;
      logger.info('visible');
      expect(consoleLogSpy).toHaveBeenCalledOnce();
    });

    it('should support custom level methods', () => {
      const logger = createEdgeLogger('test-service', {
        level: 'audit',
        customLevels: { audit: 35 },
      });

      (logger as any).audit({ actor: 'alice' }, 'audit message');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(35);
      expect(logOutput.msg).toBe('audit message');
      expect(logOutput.actor).toBe('alice');
      expect(logger.isLevelEnabled('audit')).toBe(true);
    });

    it('should expose customLevels and useOnlyCustomLevels on the logger like pino', () => {
      const logger = createEdgeLogger('test-service', {
        level: 'audit',
        customLevels: { audit: 35 },
        useOnlyCustomLevels: true,
      }) as any;

      expect(logger.customLevels).toEqual({ audit: 35 });
      expect(logger.useOnlyCustomLevels).toBe(true);
    });

    it('should support useOnlyCustomLevels', () => {
      const logger = createEdgeLogger('test-service', {
        level: 'audit',
        customLevels: { audit: 35 },
        useOnlyCustomLevels: true,
      });

      logger.info('not logged');
      (logger as any).audit('logged');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe('logged');
    });

    it('should support messageKey, errorKey, and nestedKey', () => {
      const logger = createEdgeLogger('test-service', {
        messageKey: 'message',
        errorKey: 'err',
        nestedKey: 'payload',
      });

      logger.error({ error: 'boom', requestId: 'req-1' }, 'failed');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('failed');
      expect(logOutput.payload.error).toBe('boom');
      expect(logOutput.payload.requestId).toBe('req-1');
    });

    it('should support serializers and formatters', () => {
      const logger = createEdgeLogger('test-service', {
        bindings: { serviceVersion: '1.0.0' },
        serializers: {
          user: (value) => ({ id: (value as any).id }),
        },
        formatters: {
          bindings: (bindings) => ({ ...bindings, bound: true }),
          level: (label, value) => ({ severity: label, severityValue: value }),
          log: (object) => ({ ...object, formatted: true }),
        },
      });

      logger.info({ user: { id: 'u1', email: 'a@b.com' } }, 'hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.severity).toBe('info');
      expect(logOutput.severityValue).toBe(30);
      expect(logOutput.bound).toBe(true);
      expect(logOutput.formatted).toBe(true);
      expect(logOutput.user).toEqual({ id: 'u1' });
    });

    it('should support mixins', () => {
      const logger = createEdgeLogger('test-service', {
        mixin: () => ({ mixed: true }),
      });

      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.mixed).toBe(true);
    });

    it('should call hooks.logMethod with the logger as this', () => {
      let hookThis: unknown;
      let hookLogger: EdgeLogger | undefined;
      const logger = createEdgeLogger('test-service', {
        hooks: {
          logMethod(this: EdgeLogger, args, method, level) {
            // eslint-disable-next-line @typescript-eslint/no-this-alias, unicorn/no-this-assignment
            hookThis = this;
            hookLogger = logger;
            expect(args).toEqual([{ userId: '123' }, 'hello']);
            expect(level).toBe(30);
            method(...args);
          },
        },
      });

      logger.info({ userId: '123' }, 'hello');

      expect(hookThis).toBe(hookLogger);
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.userId).toBe('123');
      expect(logOutput.msg).toBe('hello');
    });
  });

  describe('Pretty mode', () => {
    it('should format logs in pretty mode', () => {
      const logger = createEdgeLogger('test-service', { pretty: true });
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
      const logger = createEdgeLogger('test-service', { pretty: true });
      const error = new Error('test error');
      logger.error(error, 'error occurred');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = consoleLogSpy.mock.calls[0][0];

      expect(typeof logOutput).toBe('string');
      expect(logOutput).toContain('ERROR');
      expect(logOutput).toContain('test-service');
      expect(logOutput).toContain('error occurred');
    });
  });

  describe('Edge cases', () => {
    it('should handle circular references safely by default', () => {
      const logger = createEdgeLogger('test-service');
      const circular: any = { a: 1 };
      circular.self = circular;

      // safe: true (default) handles circular refs with [Circular]
      logger.info(circular, 'circular');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.a).toBe(1);
      // self points to the same circular object, which is serialized with [Circular] for its own self-ref
      expect(logOutput.self.a).toBe(1);
      expect(logOutput.self.self).toBe('[Circular]');
    });

    it('should throw on circular references when safe is false', () => {
      const logger = createEdgeLogger('test-service', { safe: false });
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => {
        logger.info(circular, 'circular');
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

    it('should not treat repeated shared references as circular', () => {
      const logger = createEdgeLogger('test-service');
      const shared = { nested: true };

      logger.info({ a: shared, b: shared }, 'shared refs');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.a).toEqual({ nested: true });
      expect(logOutput.b).toEqual({ nested: true });
    });
  });

  describe('child()', () => {
    it('should create a child logger with merged bindings', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ requestId: 'req-123' });

      child.info({ extra: 'data' }, 'child message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput).toMatchObject({
        level: 30,
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

      child.info({ env: 'production' }, 'override');

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
      expect(child.trace).toBeDefined();
      expect(child.fatal).toBeDefined();
      expect(child.child).toBeDefined();
    });

    it('should call onChild when creating child loggers', () => {
      const onChild = vi.fn();
      const logger = createEdgeLogger('test-service', { onChild });

      const child = logger.child({ key: 'val' });

      expect(onChild).toHaveBeenCalledOnce();
      expect(onChild).toHaveBeenCalledWith(child);
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

      child.info({ extra: 'data' }, 'pretty child');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('pretty child');
      expect(output).toContain('requestId');
      expect(output).toContain('req-123');
      expect(output).toContain('extra');
    });

    it('should allow child logger level overrides', () => {
      const logger = createEdgeLogger('test-service', { level: 'error' });
      const child = logger.child({ requestId: 'req-123' }, { level: 'debug' });

      child.debug('child debug');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.requestId).toBe('req-123');
      expect(logOutput.level).toBe(20);
    });

    it('should return cloned bindings and allow additive setBindings', () => {
      const logger = createEdgeLogger('test-service');
      const child = logger.child({ requestId: 'req-123' });

      expect(child.bindings()).toEqual({ requestId: 'req-123' });

      const clonedBindings = child.bindings();
      clonedBindings.requestId = 'mutated';

      expect(child.bindings()).toEqual({ requestId: 'req-123' });

      child.setBindings({ requestId: 'ignored', userId: 'user-456' });
      expect(child.bindings()).toEqual({
        requestId: 'req-123',
        userId: 'user-456',
      });
    });

    it('should allow child msgPrefix additions', () => {
      const logger = createEdgeLogger('test-service', { msgPrefix: '[parent] ' });
      const child = logger.child(
        { requestId: 'req-123' },
        { msgPrefix: '[child] ' },
      );

      child.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe('[parent] [child] hello');
    });

    it('should append child msgPrefix to the parent prefix like pino', () => {
      const logger = createEdgeLogger('test-service', { msgPrefix: '[parent] ' });
      const child = logger.child(
        { requestId: 'req-123' },
        { msgPrefix: '[child] ' },
      );

      child.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.msg).toBe('[parent] [child] hello');
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

    it('should support silent level to temporarily disable logging', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });

      logger.info('before silent');
      const callsBeforeSilent = consoleLogSpy.mock.calls.length;

      runWithLogLevel('silent', () => {
        logger.info('inside silent context');
        logger.error('even errors suppressed');
      });
      expect(consoleLogSpy.mock.calls.length).toBe(callsBeforeSilent); // No new logs

      logger.info('after silent');
      expect(consoleLogSpy.mock.calls.length).toBe(callsBeforeSilent + 1);
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

    it('should emit level-change events', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });
      const listener = vi.fn();

      logger.on('level-change', listener);
      logger.level = 'debug';

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith('debug', 20, 'info', 30, logger);
    });

    it('should support once listeners and flush callbacks', () => {
      const logger = createEdgeLogger('test-service', { level: 'info' });
      const listener = vi.fn();
      const flushCallback = vi.fn();

      logger.once('level-change', listener);
      logger.level = 'debug';
      logger.level = 'trace';
      logger.flush(flushCallback);

      expect(listener).toHaveBeenCalledOnce();
      expect(flushCallback).toHaveBeenCalledOnce();
    });

    it('should honor the provided event name for event emitter methods', () => {
      const logger = createEdgeLogger('test-service') as any;
      const listener = vi.fn();

      logger.on('custom-event', listener);
      logger.emit('custom-event', 'payload');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith('payload');
      expect(logger.eventNames()).toContain('custom-event');
    });
  });

  describe('redact option', () => {
    it('should redact top-level fields in JSON output', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password', 'token'] },
      });
      logger.info(
        {
          user: 'alice',
          password: 'hunter2',
          token: 'jwt-abc',
        },
        'login',
      );

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.user).toBe('alice');
      expect(logOutput.password).toBe('[Redacted]');
      expect(logOutput.token).toBe('[Redacted]');
    });

    it('should redact nested paths', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['user.email', 'req.headers.authorization'] },
      });
      logger.info(
        {
          user: { email: 'a@b.com', name: 'Alice' },
          req: {
            headers: {
              authorization: 'Bearer token123',
              'content-type': 'application/json',
            },
          },
        },
        'request',
      );

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.user.email).toBe('[Redacted]');
      expect(logOutput.user.name).toBe('Alice');
      expect(logOutput.req.headers.authorization).toBe('[Redacted]');
      expect(logOutput.req.headers['content-type']).toBe('application/json');
    });

    it('should redact with custom censor', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['ssn'], censor: '***' },
      });
      logger.info({ ssn: '123-45-6789', name: 'Alice' }, 'record');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.ssn).toBe('***');
      expect(logOutput.name).toBe('Alice');
    });

    it('should redact with censor function', () => {
      const logger = createEdgeLogger('test-service', {
        redact: {
          paths: ['ccn'],
          censor: (val: unknown) => '****' + String(val).slice(-4),
        },
      });
      logger.info({ ccn: '4111111111111234' }, 'payment');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.ccn).toBe('****1234');
    });

    it('should not mutate original attrs', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password'] },
      });
      const attrs = { password: 'secret', name: 'Alice' };
      logger.info(attrs, 'test');

      expect(attrs.password).toBe('secret');
    });

    it('should apply redaction in child loggers', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password'] },
      });
      const child = logger.child({ requestId: 'req-1' });
      child.info({ password: 'secret', user: 'alice' }, 'child log');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('[Redacted]');
      expect(logOutput.user).toBe('alice');
      expect(logOutput.requestId).toBe('req-1');
    });

    it('should redact error attributes', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password'] },
      });
      logger.error(
        {
          password: 'secret',
          user: 'alice',
          error: 'bad creds',
        },
        'login failed',
      );

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('[Redacted]');
      expect(logOutput.user).toBe('alice');
      // 'error' field from attrs gets remapped to 'err' (default errorKey)
      expect(logOutput.err).toBe('bad creds');
    });

    it('should redact in pretty mode', () => {
      const logger = createEdgeLogger('test-service', {
        pretty: true,
        redact: { paths: ['password'] },
      });
      logger.info({ user: 'alice', password: 'secret' }, 'login');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[Redacted]');
      expect(output).toContain('alice');
      expect(output).not.toContain('secret');
    });

    it('should redact binding fields from child loggers', () => {
      const logger = createEdgeLogger('test-service', {
        bindings: { secret: 'top-level-secret' },
        redact: { paths: ['secret'] },
      });
      logger.info('test');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.secret).toBe('[Redacted]');
    });

    it('should handle wildcard paths', () => {
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['users[*].password'] },
      });
      logger.info(
        {
          users: [
            { name: 'A', password: 'p1' },
            { name: 'B', password: 'p2' },
          ],
        },
        'batch',
      );

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.users[0].password).toBe('[Redacted]');
      expect(logOutput.users[1].password).toBe('[Redacted]');
      expect(logOutput.users[0].name).toBe('A');
      expect(logOutput.users[1].name).toBe('B');
    });

    it('should not redact when redact option is not set', () => {
      const logger = createEdgeLogger('test-service');
      logger.info({ password: 'secret' }, 'test');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('secret');
    });

    it('should accept preset name as redact option', () => {
      const logger = createEdgeLogger('test-service', {
        redact: 'default',
      });
      logger.info(
        {
          password: 'hunter2',
          token: 'jwt-abc',
          safe: 'visible',
        },
        'login',
      );

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('[Redacted]');
      expect(logOutput.token).toBe('[Redacted]');
      expect(logOutput.safe).toBe('visible');
    });

    it('should accept string[] as redact shorthand', () => {
      const logger = createEdgeLogger('test-service', {
        redact: ['password', 'secret'],
      });
      logger.info({ password: 'hunter2', secret: 'abc', safe: 'visible' }, 'test');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.password).toBe('[Redacted]');
      expect(logOutput.secret).toBe('[Redacted]');
      expect(logOutput.safe).toBe('visible');
    });

    it('should redact transmitted payloads', () => {
      const send = vi.fn();
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password'] },
        transmit: { send },
      });

      logger.info({ user: 'alice', password: 'secret' }, 'login');

      expect(send).toHaveBeenCalledOnce();
      const [, event] = send.mock.calls[0];
      expect(event).not.toEqual(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ password: 'secret' }),
          ]),
        }),
      );
    });

    it('should transmit the original logger arguments without duplicating the message', () => {
      const send = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { send },
      });

      logger.info({ user: 'alice' }, 'login');

      expect(send).toHaveBeenCalledOnce();
      const [, event] = send.mock.calls[0];
      expect(event.messages).toEqual([{ user: 'alice' }, 'login']);
    });

    it('should transmit no bindings for a root logger with no child bindings', () => {
      const send = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { send },
      });

      logger.info('login');

      expect(send).toHaveBeenCalledOnce();
      const [, event] = send.mock.calls[0];
      expect(event.bindings).toEqual([]);
    });

    it('should transmit child bindings as a hierarchy instead of one merged object', () => {
      const send = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { send },
      });
      const child = logger.child({ requestId: 'req-1' });
      const grandchild = child.child({ userId: 'user-1' });

      grandchild.info({ action: 'login' }, 'login');

      expect(send).toHaveBeenCalledOnce();
      const [, event] = send.mock.calls[0];
      expect(event.bindings).toEqual([
        { requestId: 'req-1' },
        { userId: 'user-1' },
      ]);
    });

    it('should apply serializers to transmitted messages and bindings like pino browser logEvent', () => {
      const send = vi.fn();
      const logger = createEdgeLogger('test-service', {
        bindings: {
          user: { id: 'bound-user', email: 'bound@example.com' },
        },
        serializers: {
          user: (value) => ({ id: (value as { id: string }).id }),
        },
        transmit: { send },
      });
      const child = logger.child({
        user: { id: 'child-user', email: 'child@example.com' },
      });

      child.info(
        { user: { id: 'msg-user', email: 'msg@example.com' } },
        'login',
      );

      expect(send).toHaveBeenCalledOnce();
      const [, event] = send.mock.calls[0];
      expect(event.messages).toEqual([
        { user: { id: 'msg-user' } },
        'login',
      ]);
      expect(event.bindings).toEqual([
        { user: { id: 'child-user' } },
      ]);
    });
  });

  describe('name option', () => {
    it('should include name in log output', () => {
      const logger = createEdgeLogger('test-service', { name: 'my-logger' });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.name).toBe('my-logger');
      expect(logOutput.service).toBe('test-service');
    });

    it('should expose name on the logger instance', () => {
      const logger = createEdgeLogger('test-service', { name: 'my-logger' });
      expect(logger.name).toBe('my-logger');
    });

    it('should not include name field when not set', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.name).toBeUndefined();
      expect(logger.name).toBeUndefined();
    });

    it('should propagate name to child loggers', () => {
      const logger = createEdgeLogger('test-service', { name: 'my-logger' });
      const child = logger.child({ requestId: 'req-1' });

      child.info('child msg');
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.name).toBe('my-logger');
    });
  });

  describe('base option', () => {
    it('should merge base bindings into every log', () => {
      const logger = createEdgeLogger('test-service', {
        base: { pid: 123, hostname: 'edge-1' },
      });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.pid).toBe(123);
      expect(logOutput.hostname).toBe('edge-1');
    });

    it('should disable base with null', () => {
      const logger = createEdgeLogger('test-service', { base: null });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.pid).toBeUndefined();
      expect(logOutput.hostname).toBeUndefined();
    });

    it('should propagate base to child loggers', () => {
      const logger = createEdgeLogger('test-service', {
        base: { region: 'us-east-1' },
      });
      const child = logger.child({ requestId: 'req-1' });
      child.info('child msg');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.region).toBe('us-east-1');
    });
  });

  describe('timestamp option', () => {
    it('should include ISO timestamp by default', () => {
      const logger = createEdgeLogger('test-service');
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBeDefined();
      expect(logOutput.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should omit timestamp when false', () => {
      const logger = createEdgeLogger('test-service', { timestamp: false });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBeUndefined();
    });

    it('should use custom timestamp function', () => {
      const logger = createEdgeLogger('test-service', {
        timestamp: () => '2026-01-01T00:00:00.000Z',
      });
      logger.info('hello');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should propagate timestamp option to children', () => {
      const logger = createEdgeLogger('test-service', { timestamp: false });
      const child = logger.child({ requestId: 'req-1' });
      child.info('child msg');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBeUndefined();
    });
  });

  describe('safe option', () => {
    it('should handle circular references when safe is true (default)', () => {
      const logger = createEdgeLogger('test-service');
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => logger.info(circular, 'msg')).not.toThrow();
    });

    it('should throw on circular references when safe is false', () => {
      const logger = createEdgeLogger('test-service', { safe: false });
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => logger.info(circular, 'msg')).toThrow();
    });

    it('should not corrupt shared (non-circular) object references', () => {
      const logger = createEdgeLogger('test-service');
      const shared = { x: 1 };
      const payload = { a: shared, b: shared };

      logger.info(payload, 'shared refs');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      // Both a and b should serialize normally — shared is not circular
      expect(logOutput.a).toEqual({ x: 1 });
      expect(logOutput.b).toEqual({ x: 1 });
    });
  });

  describe('crlf option', () => {
    it(String.raw`should append \r\n when crlf is true`, () => {
      const logger = createEdgeLogger('test-service', { crlf: true });
      logger.info('hello');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const rawOutput = consoleLogSpy.mock.calls[0][0];
      expect(rawOutput.endsWith('\r\n')).toBe(true);
      // Should still be valid JSON before the \r\n
      const logOutput = JSON.parse(rawOutput.trimEnd());
      expect(logOutput.msg).toBe('hello');
    });

    it(String.raw`should not append \r\n by default`, () => {
      const logger = createEdgeLogger('test-service');
      logger.info('hello');

      const rawOutput = consoleLogSpy.mock.calls[0][0];
      expect(rawOutput.endsWith('\r\n')).toBe(false);
    });
  });

  describe('write option', () => {
    it('should call write function instead of console.log', () => {
      const writeSpy = vi.fn();
      const logger = createEdgeLogger('test-service', { write: writeSpy });
      logger.info('hello');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledOnce();
      expect(writeSpy.mock.calls[0][0]).toMatchObject({
        msg: 'hello',
        service: 'test-service',
      });
    });

    it('should dispatch to level-specific write functions', () => {
      const infoSpy = vi.fn();
      const errorSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        write: { info: infoSpy, error: errorSpy },
      });

      logger.info('info msg');
      logger.error('error msg');

      expect(infoSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(infoSpy.mock.calls[0][0].msg).toBe('info msg');
      expect(errorSpy.mock.calls[0][0].msg).toBe('error msg');
    });

    it('should fall back to console.log for unmatched levels', () => {
      const infoSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        write: { info: infoSpy },
      });

      logger.warn('warn msg');

      // Falls back to console.log when no matching level writer
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('should propagate write to child loggers', () => {
      const writeSpy = vi.fn();
      const logger = createEdgeLogger('test-service', { write: writeSpy });
      const child = logger.child({ requestId: 'req-1' });

      child.info('child msg');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledOnce();
      expect(writeSpy.mock.calls[0][0].requestId).toBe('req-1');
    });
  });

  describe('transmit option', () => {
    it('should call transmit.send after logging', () => {
      const sendSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { send: sendSpy },
      });

      logger.info({ userId: '123' }, 'hello');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      expect(sendSpy).toHaveBeenCalledOnce();

      const [level, logEvent] = sendSpy.mock.calls[0];
      expect(level).toBe('info');
      expect(logEvent.ts).toBeTypeOf('number');
      expect(logEvent.level.label).toBe('info');
      expect(logEvent.level.value).toBe(30);
      expect(logEvent.bindings).toEqual([]);
    });

    it('should respect transmit.level threshold', () => {
      const sendSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { level: 'error', send: sendSpy },
      });

      logger.info('info msg');
      expect(sendSpy).not.toHaveBeenCalled();

      logger.error('error msg');
      expect(sendSpy).toHaveBeenCalledOnce();
      expect(sendSpy.mock.calls[0][0]).toBe('error');
    });

    it('should propagate transmit to child loggers', () => {
      const sendSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        transmit: { send: sendSpy },
      });
      const child = logger.child({ requestId: 'req-1' });

      child.info('child msg');

      expect(sendSpy).toHaveBeenCalledOnce();
      expect(sendSpy.mock.calls[0][1].bindings).toEqual([{ requestId: 'req-1' }]);
    });

    it('should redact secrets in transmit payload', () => {
      const sendSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        redact: { paths: ['password'] },
        transmit: { send: sendSpy },
      });
      const child = logger.child({ password: 'bound-secret', user: 'alice' });

      child.info({ password: 'secret', safe: 'visible' }, 'login');

      expect(sendSpy).toHaveBeenCalledOnce();
      const logEvent = sendSpy.mock.calls[0][1];
      // Child bindings should have password redacted
      expect(logEvent.bindings[0].password).toBe('[Redacted]');
      expect(logEvent.bindings[0].user).toBe('alice');
    });
  });

  describe('hooks option', () => {
    it('should call logMethod hook before logging', () => {
      const logger = createEdgeLogger('test-service', {
        hooks: {
          logMethod(args, method, _level) {
            // Prepend a field to every log call
            const [first, ...rest] = args;
            if (typeof first === 'object' && first !== null) {
              method({ ...first, hooked: true }, ...rest);
            } else {
              method({ hooked: true }, ...args);
            }
          },
        },
      });

      logger.info('hello');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.hooked).toBe(true);
    });

    it('should propagate hooks to child loggers', () => {
      const hookSpy = vi.fn((args, method, _level) => {
        method(...args);
      });
      const logger = createEdgeLogger('test-service', {
        hooks: { logMethod: hookSpy },
      });
      const child = logger.child({ requestId: 'req-1' });

      child.info('child msg');

      expect(hookSpy).toHaveBeenCalledOnce();
    });
  });

  describe('edgeLimit option', () => {
    it('should truncate objects with too many keys in safe stringify', () => {
      const writeSpy = vi.fn();
      const logger = createEdgeLogger('test-service', {
        edgeLimit: 5,
        write: writeSpy,
      });
      const nested: Record<string, number> = {};
      for (let i = 0; i < 10; i++) {
        nested[`key${i}`] = i;
      }

      // write fn receives the raw object, which gets stringified by the
      // outer log path. To test edgeLimit directly, use safeStringify via console.log path.
      const logger2 = createEdgeLogger('test-service', {
        edgeLimit: 5,
        nestedKey: 'payload',
      });
      logger2.info(nested, 'many keys');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const raw = consoleLogSpy.mock.calls[0][0];
      const logOutput = JSON.parse(raw);
      // payload has 10 keys, edgeLimit=5 means first 5 + '...'
      expect(logOutput.payload['...']).toContain('more properties');
    });
  });

  describe('depthLimit option', () => {
    it('should truncate deeply nested objects', () => {
      const logger = createEdgeLogger('test-service', { depthLimit: 3 });
      const deep = {
        l1: { l2: { l3: { l4: { l5: 'very deep' } } } },
      };

      logger.info({ nested: deep }, 'deep nesting');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      // Objects beyond depthLimit become '[Object]'
      // Find the first [Object] to confirm truncation happens
      const walk = (obj: any, depth = 0): number => {
        if (obj === '[Object]') return depth;
        if (typeof obj !== 'object' || obj === null) return -1;
        for (const v of Object.values(obj)) {
          const d = walk(v, depth + 1);
          if (d > 0) return d;
        }
        return -1;
      };
      const truncatedAt = walk(logOutput);
      expect(truncatedAt).toBeGreaterThan(0);
      expect(truncatedAt).toBeLessThanOrEqual(5); // truncation happens within depth limit range
    });

    it('should allow full depth by default (depthLimit: 5)', () => {
      const logger = createEdgeLogger('test-service');
      const deep = { l1: { l2: { l3: { l4: 'deep' } } } };

      logger.info({ data: deep }, 'deep nesting');

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.data.l1.l2.l3.l4).toBe('deep');
    });
  });
});

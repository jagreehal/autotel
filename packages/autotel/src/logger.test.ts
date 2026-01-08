import { describe, it, expect, vi } from 'vitest';
import { LoggedOperation, type Logger } from './logger';

describe('Logger interface', () => {
  it('should work with custom logger implementations (Pino signature)', () => {
    const mockLogger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Pino-compatible signature: (extra, message?)
    mockLogger.info({ key: 'value' }, 'Test message');
    expect(mockLogger.info).toHaveBeenCalledWith(
      { key: 'value' },
      'Test message',
    );
  });

  it('should support error method with err in extra object', () => {
    const mockLogger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const error = new Error('Test error');
    // Pino-compatible signature: error goes in extra.err
    mockLogger.error({ err: error, context: 'test' }, 'Error occurred');
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: error, context: 'test' },
      'Error occurred',
    );
  });
});

describe('@LoggedOperation decorator', () => {
  it('should support simple string syntax', async () => {
    class TestService {
      constructor(public deps: { log: Logger }) {}

      @LoggedOperation('test.operation')
      async testMethod() {
        return 'result';
      }
    }

    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const service = new TestService({ log: mockLog });
    const result = await service.testMethod();

    expect(result).toBe('result');
    // Pino-native style: (extra, message)
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'test.operation' }),
      'Operation started',
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'test.operation' }),
      'Operation completed',
    );
  });

  it('should support advanced object syntax', async () => {
    class TestService {
      constructor(public deps: { log: Logger }) {}

      @LoggedOperation({ operationName: 'test.operation' })
      async testMethod() {
        return 'result';
      }
    }

    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const service = new TestService({ log: mockLog });
    const result = await service.testMethod();

    expect(result).toBe('result');
    expect(mockLog.info).toHaveBeenCalled();
  });

  it('should record errors', async () => {
    class TestService {
      constructor(public deps: { log: Logger }) {}

      @LoggedOperation('test.failing')
      async failingMethod() {
        throw new Error('Test error');
      }
    }

    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const service = new TestService({ log: mockLog });

    await expect(service.failingMethod()).rejects.toThrow('Test error');
    // Pino-native style: (extra, message)
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'test.failing',
        err: expect.any(Error),
      }),
      'Operation failed',
    );
  });
});

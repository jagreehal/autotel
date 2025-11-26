import { describe, it, expect, vi } from 'vitest';
import { LoggedOperation, type Logger } from './logger';

describe('Logger interface', () => {
  it('should work with custom logger implementations', () => {
    const mockLogger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockLogger.info('Test message', { key: 'value' });
    expect(mockLogger.info).toHaveBeenCalledWith('Test message', {
      key: 'value',
    });
  });

  it('should support error method with optional error parameter', () => {
    const mockLogger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const error = new Error('Test error');
    mockLogger.error('Error occurred', error, { context: 'test' });
    expect(mockLogger.error).toHaveBeenCalledWith('Error occurred', error, {
      context: 'test',
    });
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
    expect(mockLog.info).toHaveBeenCalledWith(
      'Operation started',
      expect.objectContaining({ operation: 'test.operation' }),
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      'Operation completed',
      expect.objectContaining({ operation: 'test.operation' }),
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
    expect(mockLog.error).toHaveBeenCalledWith(
      'Operation failed',
      expect.any(Error),
      expect.objectContaining({ operation: 'test.failing' }),
    );
  });
});

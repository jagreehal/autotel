import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentHyperdrive } from './hyperdrive';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import {
  hyperdriveDouble,
  socketDouble,
  tracerDouble,
} from '../testing/doubles.js';
import type { UnknownRecord } from '../values.js';

describe('Hyperdrive Binding Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((_name, _options, fn) => {
        return fn(mockSpan);
      }),
    };

    getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockReturnValue(tracerDouble(mockTracer));
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  function createMockHyperdrive(overrides: UnknownRecord = {}): Hyperdrive {
    return hyperdriveDouble({
      connect: vi.fn(async () => socketDouble({})),
      connectionString:
        'postgresql://user:secret-password@db.example.com:5432/mydb',
      host: 'db.example.com',
      port: 5432,
      user: 'user',
      password: 'secret-password',
      database: 'mydb',
      ...overrides,
    });
  }

  describe('connect()', () => {
    it('should create span with correct attributes', async () => {
      const mockHyperdrive = createMockHyperdrive();
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'my-db');

      await instrumented.connect();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Hyperdrive my-db: connect');
      expect(options.kind).toBe(SpanKind.CLIENT);
      expect(options.attributes['db.system.name']).toBe(
        'cloudflare-hyperdrive',
      );
      expect(options.attributes['db.operation.name']).toBe('connect');
      expect(options.attributes['server.address']).toBe('db.example.com');
      expect(options.attributes['server.port']).toBe(5432);
      expect(options.attributes['db.user']).toBe('user');
    });

    it('should handle errors correctly', async () => {
      const connectError = new Error('Connection refused');
      const mockHyperdrive = createMockHyperdrive({
        connect: vi.fn(async () => {
          throw connectError;
        }),
      });
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'my-db');

      await expect(instrumented.connect()).rejects.toThrow(
        'Connection refused',
      );

      expect(mockSpan.recordException).toHaveBeenCalledWith(connectError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Connection refused',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should set OK status and end span on success', async () => {
      const mockSocket = socketDouble({ readable: true });
      const mockHyperdrive = createMockHyperdrive({
        connect: vi.fn(async () => mockSocket),
      });
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'my-db');

      const result = await instrumented.connect();

      expect(result).toBe(mockSocket);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use default binding name when none provided', async () => {
      const mockHyperdrive = createMockHyperdrive();
      const instrumented = instrumentHyperdrive(mockHyperdrive);

      await instrumented.connect();

      const [spanName] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Hyperdrive hyperdrive: connect');
    });
  });

  describe('this-binding', () => {
    it('should invoke connect() with original object as this, not the proxy', async () => {
      const receivedThis: unknown[] = [];
      const mockHyperdrive = hyperdriveDouble({
        connect: vi.fn(async function (this: unknown) {
          receivedThis.push(this);
          return socketDouble({});
        }),
        connectionString: 'postgresql://user:pass@host:5432/db',
        host: 'host',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db',
      });
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'test');
      await instrumented.connect();
      expect(receivedThis[0]).toBe(mockHyperdrive);
    });
  });

  describe('non-instrumented properties', () => {
    it('should pass through non-instrumented properties', () => {
      const mockHyperdrive = createMockHyperdrive();
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'my-db');

      expect(instrumented.connectionString).toBe(
        'postgresql://user:secret-password@db.example.com:5432/mydb',
      );
      expect(instrumented.host).toBe('db.example.com');
      expect(instrumented.port).toBe(5432);
      expect(instrumented.user).toBe('user');
      expect(instrumented.database).toBe('mydb');
    });
  });

  describe('security', () => {
    it('should never record password as an attribute', async () => {
      const mockHyperdrive = createMockHyperdrive({
        password: 'super-secret-password',
      });
      const instrumented = instrumentHyperdrive(mockHyperdrive, 'my-db');

      await instrumented.connect();

      const [, options] = mockTracer.startActiveSpan.mock.calls[0];

      // Verify password is not in the attributes
      const attributeKeys = Object.keys(options.attributes);
      for (const key of attributeKeys) {
        expect(options.attributes[key]).not.toBe('super-secret-password');
      }
      expect(options.attributes['db.password']).toBeUndefined();
      expect(options.attributes['password']).toBeUndefined();

      // Also verify setAttribute was not called with the password
      for (const call of mockSpan.setAttribute.mock.calls) {
        expect(call[1]).not.toBe('super-secret-password');
      }
    });
  });
});

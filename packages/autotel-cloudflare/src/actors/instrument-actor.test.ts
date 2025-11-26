/**
 * Tests for Actor instrumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instrumentActor } from './instrument-actor';
import type { ActorLike } from './types';

// Mock dependencies
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn((name, options, contextOrCallback, maybeCallback) => {
        const callback = typeof contextOrCallback === 'function' ? contextOrCallback : maybeCallback;
        const mockSpan = {
          setAttributes: vi.fn(),
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        };
        return callback(mockSpan);
      }),
    }),
  },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => unknown) => fn(),
  },
  propagation: {
    extract: () => ({}),
  },
  SpanStatusCode: {
    OK: 'OK',
    ERROR: 'ERROR',
  },
  SpanKind: {
    SERVER: 'SERVER',
    INTERNAL: 'INTERNAL',
    CLIENT: 'CLIENT',
    PRODUCER: 'PRODUCER',
  },
}));

vi.mock('autotel-edge', () => ({
  createInitialiser: () => () => ({}),
  setConfig: () => ({}),
  WorkerTracer: class {},
}));

vi.mock('../bindings/common', () => ({
  wrap: <T>(target: T, handler: ProxyHandler<T>): T => new Proxy(target, handler) as T,
}));

// Mock Actor class for testing
class MockActor implements ActorLike {
  name = 'test-actor';
  identifier = 'test-123';
  storage = {};
  alarms = {};
  sockets = {};

  async onInit(): Promise<void> {
    // Mock initialization
  }

  async onRequest(request: Request): Promise<Response> {
    return new Response('OK');
  }

  async onAlarm(): Promise<void> {
    // Mock alarm
  }

  onPersist(key: string, value: unknown): void {
    // Mock persist
  }

  async fetch(request: Request): Promise<Response> {
    return this.onRequest(request);
  }

  async alarm(): Promise<void> {
    return this.onAlarm();
  }
}

// Mock DurableObjectState
const mockState = {
  id: {
    toString: () => 'do-id-123',
    name: 'test-do',
  },
  storage: {},
} as unknown as DurableObjectState;

describe('instrumentActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an instrumented class constructor', () => {
    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      { service: { name: 'test-service' } },
    );

    expect(typeof InstrumentedActor).toBe('function');
  });

  it('should create an instrumented instance', () => {
    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      { service: { name: 'test-service' } },
    );

    const instance = new InstrumentedActor(mockState, {});
    expect(instance).toBeDefined();
  });

  it('should support config as a function', () => {
    const configFn = vi.fn(() => ({ service: { name: 'dynamic-service' } }));

    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      configFn,
    );

    new InstrumentedActor(mockState, { API_KEY: 'test' });

    expect(configFn).toHaveBeenCalled();
  });

  it('should support actors-specific options', () => {
    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      {
        service: { name: 'test-service' },
        actors: {
          instrumentStorage: false,
          capturePersistEvents: true,
        },
      },
    );

    const instance = new InstrumentedActor(mockState, {});
    expect(instance).toBeDefined();
  });
});

describe('ActorInstrumentationOptions', () => {
  it('should default instrumentStorage to true', () => {
    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      { service: { name: 'test' } },
    );

    const instance = new InstrumentedActor(mockState, {});
    // Storage should be instrumented by default
    expect(instance.storage).toBeDefined();
  });

  it('should respect custom spanNameFormatter', () => {
    const formatter = vi.fn((actorName: string, lifecycle: string) => `Custom: ${actorName} - ${lifecycle}`);

    const InstrumentedActor = instrumentActor(
      MockActor as unknown as new (state: DurableObjectState, env: unknown) => ActorLike,
      {
        service: { name: 'test' },
        actors: {
          spanNameFormatter: formatter,
        },
      },
    );

    const instance = new InstrumentedActor(mockState, {});
    expect(instance).toBeDefined();
  });
});

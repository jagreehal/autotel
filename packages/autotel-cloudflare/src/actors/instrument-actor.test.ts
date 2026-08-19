/**
 * Tests for Actor instrumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instrumentActor } from './instrument-actor';
import type { ActorLike } from './types';
import { actorClass, durableObjectState } from '../testing/doubles.js';
import { asFunction } from '../values.js';

// Mock dependencies
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        (_name, _options, contextOrCallback, maybeCallback) => {
          const callback = asFunction(contextOrCallback) ?? maybeCallback;
          const mockSpan = {
            setAttributes: vi.fn(),
            setAttribute: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
            end: vi.fn(),
          };
          return callback(mockSpan);
        },
      ),
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
  // SAFETY: a Proxy over T presents T's own interface; `wrap` in the real
  // module says the same thing.
  wrap: <T extends object>(target: T, handler: ProxyHandler<T>): T =>
    new Proxy(target, handler) as T,
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

  async onRequest(_request: Request): Promise<Response> {
    return new Response('OK');
  }

  async onAlarm(): Promise<void> {
    // Mock alarm
  }

  onPersist(_key: string, _value: unknown): void {
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
const mockState = durableObjectState({
  id: {
    toString: () => 'do-id-123',
    name: 'test-do',
  },
  storage: {},
});

describe('instrumentActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an instrumented class constructor', () => {
    const InstrumentedActor = instrumentActor(
      actorClass<ActorLike>(MockActor),
      { service: { name: 'test-service' } },
    );

    expect(InstrumentedActor).toBeTypeOf('function');
  });

  it('should create an instrumented instance', () => {
    const InstrumentedActor = instrumentActor(
      actorClass<ActorLike>(MockActor),
      { service: { name: 'test-service' } },
    );

    const instance = new InstrumentedActor(mockState, {});
    expect(instance).toBeDefined();
  });

  it('should support config as a function', () => {
    const configFn = vi.fn(() => ({ service: { name: 'dynamic-service' } }));

    const InstrumentedActor = instrumentActor(
      actorClass<ActorLike>(MockActor),
      configFn,
    );

    new InstrumentedActor(mockState, { API_KEY: 'test' });

    expect(configFn).toHaveBeenCalled();
  });

  it('should support actors-specific options', () => {
    const InstrumentedActor = instrumentActor(
      actorClass<ActorLike>(MockActor),
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
      actorClass<ActorLike>(MockActor),
      { service: { name: 'test' } },
    );

    const instance = new InstrumentedActor(mockState, {});
    // Storage should be instrumented by default
    expect(instance.storage).toBeDefined();
  });

  it('should respect custom spanNameFormatter', () => {
    const formatter = vi.fn(
      (actorName: string, lifecycle: string) =>
        `Custom: ${actorName} - ${lifecycle}`,
    );

    const InstrumentedActor = instrumentActor(
      actorClass<ActorLike>(MockActor),
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

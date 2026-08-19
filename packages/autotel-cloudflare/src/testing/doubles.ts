/**
 * Stand-ins for the Workers runtime objects these tests are handed.
 *
 * A worker receives its env, execution context, bindings and Durable Object
 * state from the runtime, and their types describe far more than any
 * instrumentation reads. Building them here means the one assertion that
 * makes a hand-built object usable is stated once, with the reason, instead
 * of at every call site.
 */
import { vi } from 'vitest';
import type { Span, Tracer } from '@opentelemetry/api';
import type { UnknownRecord } from '../values.js';
import type { ImagesLike } from '../bindings/images.js';

/**
 * A hand-built object, as the runtime type the code under test expects.
 *
 * SAFETY: each wrapper below names one runtime type and says which of its
 * members the instrumentation actually touches; a test supplies those and
 * nothing else. The `unknown` hop is TypeScript's - a bag of members and a
 * runtime interface never overlap in one step.
 */
function runtimeDouble<TRuntime>(members: object): TRuntime {
  return members as unknown as TRuntime;
}

/** An execution context: the instrumentation only ever schedules work on it. */
export function executionContext(
  waitUntil: (promise: Promise<unknown>) => void = vi.fn(),
): ExecutionContext {
  // waitUntil() and passThroughOnException() are the whole surface used.
  return runtimeDouble({ waitUntil, passThroughOnException: vi.fn() });
}

/** An empty env, for the paths that do not read a binding. */
export function emptyEnv<Env>(bindings: Partial<Env> = {}): Env {
  // SAFETY: a worker's env is whatever wrangler bound; a test that reads a
  // binding passes it in, and one that does not reads nothing from this.
  return bindings as Env;
}

/** A tracer double, for the tests that assert on the spans it was asked for. */
export function tracerDouble(tracer: UnknownRecord): Tracer {
  // startSpan() is the whole surface the instrumentation uses.
  return runtimeDouble(tracer);
}

/** A span double, for the tests that assert on what was recorded on it. */
export function spanDouble(span: UnknownRecord): Span {
  // setAttribute(s), setStatus, recordException and end.
  return runtimeDouble(span);
}

/** A KV namespace double: get/put/delete/list are what instrumentKV wraps. */
export function kvDouble(kv: UnknownRecord): KVNamespace {
  return runtimeDouble(kv);
}

/** An R2 bucket double: instrumentR2 wraps the methods a test supplies. */
export function r2Double(bucket: UnknownRecord): R2Bucket {
  return runtimeDouble(bucket);
}

/** A D1 database double: instrumentD1 wraps prepare/exec. */
export function d1Double(db: UnknownRecord): D1Database {
  return runtimeDouble(db);
}

/**
 * A service binding double: instrumentServiceBinding wraps fetch().
 *
 * Takes `object` rather than a record because a test may hand over a class
 * instance - a native binding that checks its own `this` - and a class has no
 * index signature.
 */
export function fetcherDouble(fetcher: object): Fetcher {
  return runtimeDouble(fetcher);
}

/** A Vectorize index double: instrumentVectorize wraps the query methods. */
export function vectorizeDouble(index: UnknownRecord): VectorizeIndex {
  return runtimeDouble(index);
}

/** A queue double: instrumentQueueProducer wraps send/sendBatch. */
export function queueDouble(queue: UnknownRecord): Queue {
  return runtimeDouble(queue);
}

/** An Images binding double: instrumentImages wraps info() and the pipeline. */
export function imagesDouble(images: UnknownRecord): ImagesLike {
  return runtimeDouble(images);
}

/** A Hyperdrive binding double: the instrumentation reads its connection info. */
export function hyperdriveDouble(hyperdrive: UnknownRecord): Hyperdrive {
  return runtimeDouble(hyperdrive);
}

/** A TCP socket, as `connect()` hands one back. */
export function socketDouble(socket: UnknownRecord): Socket {
  return runtimeDouble(socket);
}

/** A Durable Object state double: the handlers read `id` and schedule work. */
export function durableObjectState(state: UnknownRecord): DurableObjectState {
  return runtimeDouble(state);
}

/**
 * An argument handed to an instrumented binding, as the type its signature
 * declares.
 *
 * SAFETY: these tests exercise the instrumentation, not the binding. The
 * double behind it ignores the value; what matters is the attributes the
 * wrapper derives from it, which is what each test then asserts.
 */
export function bindingArg<TArg>(value: unknown): TArg {
  return value as TArg;
}

/**
 * A test's own class, as the actor constructor instrumentActor() takes.
 *
 * SAFETY: the wrapper constructs the class it is handed and wraps the
 * lifecycle methods it declares; a test class that implements them is exactly
 * what it needs, and TypeScript cannot match a class expression to a
 * constructor signature it never declared.
 */
export function actorClass<TActor>(
  cls: unknown,
): new (state: DurableObjectState, env: unknown) => TActor {
  return cls as new (state: DurableObjectState, env: unknown) => TActor;
}

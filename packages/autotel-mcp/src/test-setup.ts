import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// Set up AsyncLocalStorage context manager for tests
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// Set up W3C trace context propagator
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

// Set up a basic tracer provider for tests
const provider = new NodeTracerProvider();
provider.register();
trace.setGlobalTracerProvider(provider);

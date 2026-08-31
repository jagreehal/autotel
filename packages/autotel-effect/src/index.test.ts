import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flush, init } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import * as Effect from 'effect/Effect';
import { layer } from './index.js';

const exporter = createMemoryExporter();

beforeAll(() => {
  init({
    service: 'autotel-effect-test',
    spanExporters: [exporter],
    debug: false,
  });
});

afterEach(async () => {
  exporter.reset();
  await flush();
});

describe('layer', () => {
  it('exports Effect.withSpan spans through autotel', async () => {
    await Effect.runPromise(
      Effect.withSpan('todo.list')(Effect.void).pipe(
        Effect.provide(layer({ serviceName: 'svc-a' })),
      ),
    );
    await flush();

    expect(exporter.findSpan('todo.list')).toMatchObject({ name: 'todo.list' });
  });

  it('nests child spans under a parent span in one trace', async () => {
    const program = Effect.withSpan('parent')(
      Effect.withSpan('child')(Effect.void),
    );

    await Effect.runPromise(
      program.pipe(Effect.provide(layer({ serviceName: 'svc-b' }))),
    );
    await flush();

    const parent = exporter.findSpan('parent');
    const child = exporter.findSpan('child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.traceId).toBe(parent!.traceId);
    expect(child!.parentSpanId).toBe(parent!.spanId);
  });

  it('records span attributes from withSpan options', async () => {
    await Effect.runPromise(
      Effect.withSpan('todo.get', { attributes: { 'todo.id': 'abc' } })(
        Effect.void,
      ).pipe(Effect.provide(layer({ serviceName: 'svc-c' }))),
    );
    await flush();

    expect(exporter.findSpan('todo.get')?.attributes['todo.id']).toBe('abc');
  });
});

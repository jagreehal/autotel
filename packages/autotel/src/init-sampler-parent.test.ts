import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { context, trace as otelTrace, TraceFlags } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { span } from './functional';
import { init } from './init';
import { flush } from './shutdown';
import type { Sampler } from './sampling';

const keepEverything: Sampler = {
  shouldSample: () => true,
  needsTailSampling: () => true,
  shouldKeepTrace: () => true,
};

/** A parent decided elsewhere, e.g. by another plugin's sampler. */
const under = (traceFlags: TraceFlags, isRemote: boolean) =>
  otelTrace.setSpanContext(context.active(), {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    traceFlags,
    isRemote,
  });

describe("init()'s sampler and the parent's decision", () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    init({
      service: 'parent-sampler-test',
      sampler: keepEverything,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
  });
  beforeEach(() => exporter.reset());

  const exported = async (traceFlags: TraceFlags, isRemote: boolean) => {
    await context.with(under(traceFlags, isRemote), () =>
      span('child', async () => {}),
    );
    await flush();
    return exporter.getFinishedSpans().map((s) => s.name);
  };

  it('drops a span whose parent in this process was not sampled', async () => {
    expect(await exported(TraceFlags.NONE, false)).toEqual([]);
  });

  it('keeps a span whose parent in this process was sampled', async () => {
    expect(await exported(TraceFlags.SAMPLED, false)).toEqual(['child']);
  });

  it("decides a remote parent's child itself, as before", async () => {
    expect(await exported(TraceFlags.NONE, true)).toEqual(['child']);
  });
});

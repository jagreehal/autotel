/**
 * A Workflow in OTLP mode, end to end: no mocked tracer. The Workflow is the
 * only thing that runs in the isolate, so it has to register the provider
 * itself and export its trace before run() returns.
 */
import { describe, expect, it } from 'vitest';
import type { ReadableSpan } from 'autotel-edge';
import { instrumentWorkflow } from './workflows';
import { rpcStub } from '../testing/doubles.js';

describe('instrumentWorkflow in OTLP mode', () => {
  it('exports the run and step spans by the time run() resolves', async () => {
    const exported: ReadableSpan[] = [];
    const exporter = {
      export: (spans: ReadableSpan[], done: (result: { code: 0 }) => void) => {
        exported.push(...spans);
        done({ code: 0 });
      },
      shutdown: async () => {},
    };

    class Checkout {
      constructor(
        public ctx: unknown,
        public env: unknown,
      ) {}
      async run(_event: unknown, step: any) {
        const user = await step.do('load user', async () => 'ada');
        await step.sleep('cool off', '1 second');
        return step.do('charge', async () => `charged ${user}`);
      }
    }

    const Instrumented = instrumentWorkflow(Checkout, 'checkout', {
      service: { name: 'checkout' },
      exporter,
    });
    const step = rpcStub({
      do: async (...args: never[]) =>
        (args.at(-1) as unknown as () => Promise<unknown>)(),
      sleep: async () => {},
    });

    const result = await new Instrumented({}, {}).run(
      { payload: {}, timestamp: new Date(), instanceId: 'wf-1' },
      step,
    );

    expect(result).toBe('charged ada');
    const names = exported.map((span) => span.name);
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        'Workflow checkout: run',
        'Workflow checkout: load user',
        'Workflow checkout: sleep cool off',
        'Workflow checkout: charge',
      ]),
    );
    const [traceId] = new Set(exported.map((s) => s.spanContext().traceId));
    expect(exported.every((s) => s.spanContext().traceId === traceId)).toBe(
      true,
    );
  });
});

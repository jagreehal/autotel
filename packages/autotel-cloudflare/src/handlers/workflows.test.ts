import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentWorkflow } from './workflows';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Workflow Instrumentation', () => {
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
      startActiveSpan: vi.fn((name, options, context, fn) => {
        if (typeof options === 'function') return options(mockSpan);
        if (typeof context === 'function') return context(mockSpan);
        if (typeof fn === 'function') return fn(mockSpan);
        return Promise.resolve();
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('instrumentWorkflow()', () => {
    it('should wrap workflow class constructor', () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run() {}
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'test-workflow', {
        service: { name: 'test' },
      });

      expect(Instrumented).toBeDefined();
      expect(typeof Instrumented).toBe('function');
    });

    it('should create workflow instance with instrumented run()', () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run() { return 'done'; }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'test-workflow', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});

      expect(instance).toBeDefined();
      expect(typeof instance.run).toBe('function');
    });

    it('should accept static config', () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run() {}
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'test-workflow', {
        service: { name: 'test', version: '1.0.0' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      expect(Instrumented).toBeDefined();
    });

    it('should accept config function', () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run() {}
      }

      interface Env {
        OTLP_ENDPOINT: string;
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'test-workflow', (env: Env) => ({
        service: { name: 'test' },
        exporter: { url: env.OTLP_ENDPOINT },
      }));

      expect(Instrumented).toBeDefined();
    });
  });

  describe('run() instrumentation', () => {
    it('should preserve run() return value', async () => {
      const output = { status: 'ok', orderId: 'ord-123' };

      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {
          return output;
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'return-test', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-return' };
      const step = { do: vi.fn(), sleep: vi.fn(), sleepUntil: vi.fn() };

      await expect(instance.run(event, step)).resolves.toEqual(output);
    });

    it('should create span for run() with workflow attributes', async () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {}
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'test-workflow', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: { foo: 'bar' }, timestamp: new Date(), instanceId: 'wf-123' };
      const step = { do: vi.fn(), sleep: vi.fn(), sleepUntil: vi.fn() };

      await instance.run(event, step);

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('Workflow test-workflow: run');

      const options = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(options.kind).toBe(SpanKind.INTERNAL);
      expect(options.attributes['workflow.name']).toBe('test-workflow');
      expect(options.attributes['workflow.instance_id']).toBe('wf-123');
      expect(options.attributes['faas.trigger']).toBe('workflow');
    });

    it('should track cold starts', async () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {}
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'cold-test', {
        service: { name: 'test' },
      });

      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-1' };
      const step = { do: vi.fn(), sleep: vi.fn(), sleepUntil: vi.fn() };

      const instance1 = new Instrumented({}, {});
      await instance1.run(event, step);
      const firstOptions = mockTracer.startActiveSpan.mock.calls[0][1];
      expect(firstOptions.attributes['faas.coldstart']).toBe(true);

      const instance2 = new Instrumented({}, {});
      await instance2.run(event, step);
      const secondOptions = mockTracer.startActiveSpan.mock.calls[1][1];
      expect(secondOptions.attributes['faas.coldstart']).toBe(false);
    });

    it('should handle run() errors', async () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run() {
          throw new Error('Workflow failed');
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'error-test', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-err' };
      const step = { do: vi.fn(), sleep: vi.fn(), sleepUntil: vi.fn() };

      await expect(instance.run(event, step)).rejects.toThrow('Workflow failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Workflow failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('step.do() instrumentation', () => {
    it('should create span for step.do() calls', async () => {
      const stepDoResult = { paymentId: 'pay_123' };
      const mockStepDo = vi.fn().mockResolvedValue(stepDoResult);

      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {
          return await step.do('process payment', async () => stepDoResult);
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'step-test', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-step' };
      const step = {
        do: vi.fn(async (_name: string, cb: () => Promise<any>) => cb()),
        sleep: vi.fn(),
        sleepUntil: vi.fn(),
      };

      await instance.run(event, step);

      // Should have spans for both run() and step.do()
      expect(mockTracer.startActiveSpan.mock.calls.length).toBeGreaterThanOrEqual(2);

      const stepSpanCall = mockTracer.startActiveSpan.mock.calls[1];
      expect(stepSpanCall[0]).toBe('Workflow step-test: process payment');
      expect(stepSpanCall[1].attributes['workflow.step.name']).toBe('process payment');
      expect(stepSpanCall[1].attributes['workflow.name']).toBe('step-test');
    });

    it('should handle step.do() errors', async () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {
          await step.do('failing step', async () => {
            throw new Error('Step failed');
          });
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'step-err', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-step-err' };
      const step = {
        do: vi.fn(async (_name: string, cb: () => Promise<any>) => cb()),
        sleep: vi.fn(),
        sleepUntil: vi.fn(),
      };

      await expect(instance.run(event, step)).rejects.toThrow('Step failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('step.sleep() instrumentation', () => {
    it('should create span for step.sleep() calls', async () => {
      class TestWorkflow {
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {
          await step.sleep('wait for settlement', '2 hours');
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'sleep-test', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-sleep' };
      const step = {
        do: vi.fn(),
        sleep: vi.fn().mockResolvedValue(undefined),
        sleepUntil: vi.fn(),
      };

      await instance.run(event, step);

      const sleepSpanCall = mockTracer.startActiveSpan.mock.calls[1];
      expect(sleepSpanCall[0]).toBe('Workflow sleep-test: sleep wait for settlement');
      expect(sleepSpanCall[1].attributes['workflow.sleep.name']).toBe('wait for settlement');
      expect(sleepSpanCall[1].attributes['workflow.sleep.duration']).toBe('2 hours');
      expect(sleepSpanCall[1].attributes['workflow.name']).toBe('sleep-test');
    });
  });

  describe('this binding', () => {
    it('should preserve this context in run()', async () => {
      class TestWorkflow {
        private value = 42;
        constructor(public ctx: any, public env: any) {}
        async run(event: any, step: any) {
          return this.value;
        }
      }

      const Instrumented = instrumentWorkflow(TestWorkflow, 'this-test', {
        service: { name: 'test' },
      });

      const instance = new Instrumented({}, {});
      const event = { payload: {}, timestamp: new Date(), instanceId: 'wf-this' };
      const step = { do: vi.fn(), sleep: vi.fn(), sleepUntil: vi.fn() };

      // Should not throw — this.value should be accessible
      await expect(instance.run(event, step)).resolves.not.toThrow();
    });
  });
});

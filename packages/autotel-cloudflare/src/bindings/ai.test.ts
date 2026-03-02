import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { instrumentAI } from './ai';

describe('AI Binding Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;
  let mockAI: any;

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
      startActiveSpan: vi.fn((name, options, fn) => {
        return fn(mockSpan);
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);

    mockAI = {
      run: vi.fn(async () => ({ response: 'Hello world' })),
      someOtherMethod: vi.fn(() => 'passthrough'),
      someProperty: 'test-value',
    };
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('instrumentAI()', () => {
    it('should wrap AI binding with proxy', () => {
      const instrumented = instrumentAI(mockAI);

      expect(instrumented).not.toBe(mockAI);
      expect(typeof instrumented.run).toBe('function');
    });

    it('should create span with correct name and attributes for run()', async () => {
      const instrumented = instrumentAI(mockAI, 'my-ai');

      await instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('AI my-ai: run @cf/meta/llama-2-7b-chat-int8');
      expect(options.kind).toBe(SpanKind.CLIENT);
      expect(options.attributes['gen_ai.system']).toBe('cloudflare-workers-ai');
      expect(options.attributes['gen_ai.operation.name']).toBe('run');
      expect(options.attributes['gen_ai.request.model']).toBe('@cf/meta/llama-2-7b-chat-int8');
    });

    it('should use default binding name "ai" when no name is provided', async () => {
      const instrumented = instrumentAI(mockAI);

      await instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' });

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toBe('AI ai: run @cf/meta/llama-2-7b-chat-int8');
    });

    it('should record token usage when result has usage.prompt_tokens and usage.completion_tokens', async () => {
      mockAI.run = vi.fn(async () => ({
        response: 'Hello world',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 25,
        },
      }));

      const instrumented = instrumentAI(mockAI);

      await instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.input_tokens', 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('gen_ai.usage.output_tokens', 25);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should NOT set token attributes when usage is not present', async () => {
      mockAI.run = vi.fn(async () => ({
        response: 'Hello world',
      }));

      const instrumented = instrumentAI(mockAI);

      await instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        'gen_ai.usage.input_tokens',
        expect.anything(),
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        'gen_ai.usage.output_tokens',
        expect.anything(),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors correctly', async () => {
      const testError = new Error('AI model failed');
      mockAI.run = vi.fn(async () => {
        throw testError;
      });

      const instrumented = instrumentAI(mockAI);

      await expect(
        instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' }),
      ).rejects.toThrow('AI model failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(testError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'AI model failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should invoke run() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockAIObj = {
        run: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { response: 'Hello' };
        }),
      };
      const instrumented = instrumentAI(mockAIObj as any, 'test');
      await instrumented.run('@cf/meta/llama-2-7b-chat-int8', { prompt: 'Hello' });
      expect(receivedThis).toBe(mockAIObj);
    });

    it('should pass through non-instrumented methods unchanged', () => {
      const instrumented = instrumentAI(mockAI);

      const result = instrumented.someOtherMethod();

      expect(result).toBe('passthrough');
      expect(mockAI.someOtherMethod).toHaveBeenCalled();
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    it('should pass through non-instrumented properties unchanged', () => {
      const instrumented = instrumentAI(mockAI);

      expect(instrumented.someProperty).toBe('test-value');
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instrumentQueueProducer } from './queue-producer';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

describe('Queue Producer Binding Instrumentation', () => {
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
      startActiveSpan: vi.fn((name, options, fn) => {
        return fn(mockSpan);
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  function createMockQueue(overrides: Partial<Queue> = {}): Queue {
    return {
      send: vi.fn(async () => ({ messageId: 'msg-123', outcome: 'ok' })),
      sendBatch: vi.fn(async () => ({})),
      ...overrides,
    } as unknown as Queue;
  }

  describe('send()', () => {
    it('should create span with PRODUCER kind and correct attributes', async () => {
      const mockQueue = createMockQueue();
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      await instrumented.send({ data: 'test-payload' });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Queue my-queue: send');
      expect(options.kind).toBe(SpanKind.PRODUCER);
      expect(options.attributes['messaging.system']).toBe('cloudflare-queues');
      expect(options.attributes['messaging.operation.type']).toBe('publish');
      expect(options.attributes['messaging.operation']).toBe('send');
      expect(options.attributes['messaging.destination.name']).toBe('my-queue');
    });

    it('should record messageId from result when available', async () => {
      const mockQueue = createMockQueue({
        send: vi.fn(async () => ({ messageId: 'msg-456', outcome: 'ok' })) as any,
      });
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      await instrumented.send({ data: 'test-payload' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('messaging.message.id', 'msg-456');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should not set messageId attribute when result has no messageId', async () => {
      const mockQueue = createMockQueue({
        send: vi.fn(async () => ({})) as any,
      });
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      await instrumented.send({ data: 'test-payload' });

      // setAttr uses the common helper which skips undefined/null values
      const messageIdCalls = mockSpan.setAttribute.mock.calls.filter(
        (call: any) => call[0] === 'messaging.message.id'
      );
      expect(messageIdCalls.length).toBe(0);
    });

    it('should handle errors in send()', async () => {
      const sendError = new Error('Queue full');
      const mockQueue = createMockQueue({
        send: vi.fn(async () => {
          throw sendError;
        }) as any,
      });
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      await expect(instrumented.send({ data: 'test-payload' })).rejects.toThrow('Queue full');

      expect(mockSpan.recordException).toHaveBeenCalledWith(sendError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Queue full',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use default queue name when none provided', async () => {
      const mockQueue = createMockQueue();
      const instrumented = instrumentQueueProducer(mockQueue);

      await instrumented.send({ data: 'test-payload' });

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Queue queue: send');
      expect(options.attributes['messaging.destination.name']).toBe('queue');
    });
  });

  describe('sendBatch()', () => {
    it('should create span with batch_message_count', async () => {
      const mockQueue = createMockQueue();
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      const messages = [
        { body: { data: 'msg-1' } },
        { body: { data: 'msg-2' } },
        { body: { data: 'msg-3' } },
      ];

      await instrumented.sendBatch(messages);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Queue my-queue: sendBatch');
      expect(options.kind).toBe(SpanKind.PRODUCER);
      expect(options.attributes['messaging.system']).toBe('cloudflare-queues');
      expect(options.attributes['messaging.operation.type']).toBe('publish');
      expect(options.attributes['messaging.operation']).toBe('sendBatch');
      expect(options.attributes['messaging.destination.name']).toBe('my-queue');
      expect(options.attributes['messaging.batch.message_count']).toBe(3);
    });

    it('should set OK status and end span on success', async () => {
      const mockQueue = createMockQueue();
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      await instrumented.sendBatch([{ body: { data: 'msg-1' } }]);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors in sendBatch()', async () => {
      const batchError = new Error('Batch limit exceeded');
      const mockQueue = createMockQueue({
        sendBatch: vi.fn(async () => {
          throw batchError;
        }) as any,
      });
      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      const messages = [{ body: { data: 'msg-1' } }, { body: { data: 'msg-2' } }];

      await expect(instrumented.sendBatch(messages)).rejects.toThrow('Batch limit exceeded');

      expect(mockSpan.recordException).toHaveBeenCalledWith(batchError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Batch limit exceeded',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('non-instrumented methods', () => {
    it('should pass through non-instrumented properties', () => {
      const mockQueue = createMockQueue();
      (mockQueue as any).customProp = 'test-value';

      const instrumented = instrumentQueueProducer(mockQueue, 'my-queue');

      expect((instrumented as any).customProp).toBe('test-value');
    });
  });
});

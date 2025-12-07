import { describe, it, expect } from 'vitest';
import { TraceFlags } from '@opentelemetry/api';
import {
  natsAdapter,
  temporalAdapter,
  cloudflareQueuesAdapter,
  datadogContextExtractor,
  b3ContextExtractor,
  xrayContextExtractor,
} from './messaging-adapters';

describe('Messaging Adapters', () => {
  describe('natsAdapter', () => {
    describe('producer', () => {
      it('should extract NATS attributes from producer args', () => {
        const mockCtx = {} as never;
        const args = [
          { subject: 'orders.created', replyTo: 'inbox.123', stream: 'ORDERS' },
        ];

        const attrs = natsAdapter.producer!.customAttributes!(mockCtx, args);

        expect(attrs).toEqual({
          'nats.subject': 'orders.created',
          'nats.reply_to': 'inbox.123',
          'nats.stream': 'ORDERS',
        });
      });

      it('should handle missing optional fields', () => {
        const mockCtx = {} as never;
        const args = [{ subject: 'orders.created' }];

        const attrs = natsAdapter.producer!.customAttributes!(mockCtx, args);

        expect(attrs).toEqual({
          'nats.subject': 'orders.created',
        });
      });

      it('should handle undefined first arg', () => {
        const mockCtx = {} as never;
        const args: unknown[] = [undefined];

        const attrs = natsAdapter.producer!.customAttributes!(mockCtx, args);

        expect(attrs).toEqual({});
      });
    });

    describe('consumer', () => {
      it('should extract headers from NATS message using toJSON()', () => {
        const msg = {
          headers: {
            toJSON: () => ({ traceparent: '00-abc-def-01' }),
          },
        };

        const headers = natsAdapter.consumer!.headersFrom!(msg);

        expect(headers).toEqual({ traceparent: '00-abc-def-01' });
      });

      it('should extract headers using get() fallback', () => {
        const msg = {
          headers: {
            get: (key: string) => {
              const map: Record<string, string> = {
                traceparent: '00-abc-def-01',
                tracestate: 'vendor=value',
              };
              return map[key];
            },
          },
        };

        const headers = natsAdapter.consumer!.headersFrom!(msg);

        expect(headers).toEqual({
          traceparent: '00-abc-def-01',
          tracestate: 'vendor=value',
        });
      });

      it('should extract headers using entries() fallback', () => {
        const msg = {
          headers: {
            entries: function* () {
              yield ['traceparent', '00-abc-def-01'] as [string, string];
              yield ['baggage', 'key=value'] as [string, string];
            },
          },
        };

        const headers = natsAdapter.consumer!.headersFrom!(msg);

        expect(headers).toEqual({
          traceparent: '00-abc-def-01',
          baggage: 'key=value',
        });
      });

      it('should handle missing headers', () => {
        const msg = {};

        const headers = natsAdapter.consumer!.headersFrom!(msg);

        expect(headers).toBeUndefined();
      });

      it('should return undefined when toJSON returns non-object', () => {
        const msg = {
          headers: {
            toJSON: () => null,
          },
        };

        const headers = natsAdapter.consumer!.headersFrom!(msg);

        expect(headers).toBeUndefined();
      });

      it('should extract NATS attributes from consumer message', () => {
        const mockCtx = {} as never;
        const msg = {
          subject: 'orders.created',
          reply: 'inbox.456',
          info: {
            stream: 'ORDERS',
            consumer: 'order-processor',
            redeliveryCount: 2,
            pending: 5,
          },
        };

        const attrs = natsAdapter.consumer!.customAttributes!(mockCtx, msg);

        expect(attrs).toEqual({
          'nats.subject': 'orders.created',
          'nats.reply_to': 'inbox.456',
          'nats.stream': 'ORDERS',
          'nats.consumer': 'order-processor',
          'nats.delivered_count': 2,
          'nats.pending': 5,
        });
      });
    });
  });

  describe('temporalAdapter', () => {
    describe('producer', () => {
      it('should extract Temporal attributes from producer args', () => {
        const mockCtx = {} as never;
        const args = [
          {
            workflowId: 'order-123',
            runId: 'run-456',
            taskQueue: 'orders-queue',
            workflowType: 'OrderWorkflow',
          },
        ];

        const attrs = temporalAdapter.producer!.customAttributes!(
          mockCtx,
          args,
        );

        expect(attrs).toEqual({
          'temporal.workflow_id': 'order-123',
          'temporal.run_id': 'run-456',
          'temporal.task_queue': 'orders-queue',
          'temporal.workflow_type': 'OrderWorkflow',
        });
      });
    });

    describe('consumer', () => {
      it('should extract Temporal activity attributes', () => {
        const mockCtx = {} as never;
        const msg = {
          workflowId: 'order-123',
          runId: 'run-456',
          activityId: 'activity-789',
          taskQueue: 'orders-queue',
          attempt: 3,
          activityType: 'ProcessOrder',
        };

        const attrs = temporalAdapter.consumer!.customAttributes!(mockCtx, msg);

        expect(attrs).toEqual({
          'temporal.workflow_id': 'order-123',
          'temporal.run_id': 'run-456',
          'temporal.activity_id': 'activity-789',
          'temporal.task_queue': 'orders-queue',
          'temporal.attempt': 3,
          'temporal.activity_type': 'ProcessOrder',
        });
      });
    });
  });

  describe('cloudflareQueuesAdapter', () => {
    describe('consumer', () => {
      it('should extract Cloudflare Queue message attributes', () => {
        const mockCtx = {} as never;
        const timestamp = new Date('2024-01-15T10:00:00Z');
        const msg = {
          id: 'msg-123',
          timestamp,
          body: { order: 'data' },
          attempts: 2,
        };

        const attrs = cloudflareQueuesAdapter.consumer!.customAttributes!(
          mockCtx,
          msg,
        );

        expect(attrs).toEqual({
          'cloudflare.queue.message_id': 'msg-123',
          'cloudflare.queue.timestamp_ms': timestamp.getTime(),
          'cloudflare.queue.attempts': 2,
        });
      });

      it('should handle missing optional fields', () => {
        const mockCtx = {} as never;
        const msg = {
          id: 'msg-123',
        };

        const attrs = cloudflareQueuesAdapter.consumer!.customAttributes!(
          mockCtx,
          msg,
        );

        expect(attrs).toEqual({
          'cloudflare.queue.message_id': 'msg-123',
        });
      });
    });
  });
});

describe('Context Extractors', () => {
  describe('datadogContextExtractor', () => {
    it('should extract Datadog trace context (decimal to hex conversion)', () => {
      // Datadog sends IDs as decimal strings
      // 1234567890123456 decimal = 462d53c8abac0 hex
      const headers = {
        'x-datadog-trace-id': '1234567890123456',
        'x-datadog-parent-id': '9876543210987654',
        'x-datadog-sampling-priority': '1',
      };

      const context = datadogContextExtractor(headers);

      // Verify the decimal -> hex conversion happened correctly
      expect(context).not.toBeNull();
      expect(context!.traceId).toBe('0000000000000000000462d53c8abac0'); // hex of 314000100301000, padded to 32
      expect(context!.spanId).toBe('002316a9e9b32086'); // hex of 9876543210000000, padded to 16
      expect(context!.traceFlags).toBe(TraceFlags.SAMPLED);
      expect(context!.isRemote).toBe(true);
    });

    it('should handle large 64-bit IDs correctly', () => {
      // Test with max 64-bit value scenarios
      const headers = {
        'x-datadog-trace-id': '9223372036854775807', // Max signed 64-bit: 7fffffffffffffff
        'x-datadog-parent-id': '18446744073709551615', // Max unsigned 64-bit: ffffffffffffffff
        'x-datadog-sampling-priority': '1',
      };

      const context = datadogContextExtractor(headers);

      expect(context).not.toBeNull();
      expect(context!.traceId).toBe('00000000000000007fffffffffffffff');
      expect(context!.spanId).toBe('ffffffffffffffff');
    });

    it('should handle unsampled traces', () => {
      const headers = {
        'x-datadog-trace-id': '1234567890123456',
        'x-datadog-parent-id': '9876543210987654',
        'x-datadog-sampling-priority': '0',
      };

      const context = datadogContextExtractor(headers);

      expect(context).not.toBeNull();
      expect(context!.traceFlags).toBe(TraceFlags.NONE);
    });

    it('should return null for missing trace ID', () => {
      const headers = {
        'x-datadog-parent-id': '9876543210987654',
      };

      const context = datadogContextExtractor(headers);

      expect(context).toBeNull();
    });

    it('should return null for missing span ID', () => {
      const headers = {
        'x-datadog-trace-id': '1234567890123456',
      };

      const context = datadogContextExtractor(headers);

      expect(context).toBeNull();
    });

    it('should return null for invalid decimal strings', () => {
      const headers = {
        'x-datadog-trace-id': 'not-a-number',
        'x-datadog-parent-id': '9876543210987654',
      };

      const context = datadogContextExtractor(headers);

      expect(context).toBeNull();
    });

    it('should default to sampled when priority header missing', () => {
      const headers = {
        'x-datadog-trace-id': '1234567890123456',
        'x-datadog-parent-id': '9876543210987654',
      };

      const context = datadogContextExtractor(headers);

      expect(context?.traceFlags).toBe(TraceFlags.SAMPLED);
    });
  });

  describe('b3ContextExtractor', () => {
    describe('single-header format', () => {
      it('should extract B3 single-header format', () => {
        const headers = {
          b3: '80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-1',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toEqual({
          traceId: '80f198ee56343ba864fe8b2a57d3eff7',
          spanId: 'e457b5a2e4d86bd1',
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true,
        });
      });

      it('should handle unsampled B3 single-header', () => {
        const headers = {
          b3: '80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-0',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toEqual({
          traceId: '80f198ee56343ba864fe8b2a57d3eff7',
          spanId: 'e457b5a2e4d86bd1',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        });
      });

      it('should handle debug flag (d) as not sampled', () => {
        const headers = {
          b3: '80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-d',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toEqual({
          traceId: '80f198ee56343ba864fe8b2a57d3eff7',
          spanId: 'e457b5a2e4d86bd1',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        });
      });

      it('should return null for b3: 0 (deny sampling)', () => {
        const headers = {
          b3: '0',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toBeNull();
      });

      it('should handle uppercase B3 header', () => {
        const headers = {
          B3: '80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-1',
        };

        const context = b3ContextExtractor(headers);

        expect(context).not.toBeNull();
        expect(context?.traceId).toBe('80f198ee56343ba864fe8b2a57d3eff7');
      });
    });

    describe('multi-header format', () => {
      it('should extract B3 multi-header format', () => {
        const headers = {
          'x-b3-traceid': '80f198ee56343ba864fe8b2a57d3eff7',
          'x-b3-spanid': 'e457b5a2e4d86bd1',
          'x-b3-sampled': '1',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toEqual({
          traceId: '80f198ee56343ba864fe8b2a57d3eff7',
          spanId: 'e457b5a2e4d86bd1',
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true,
        });
      });

      it('should handle case-insensitive headers', () => {
        const headers = {
          'X-B3-TraceId': '80f198ee56343ba864fe8b2a57d3eff7',
          'X-B3-SpanId': 'e457b5a2e4d86bd1',
          'X-B3-Sampled': '0',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toEqual({
          traceId: '80f198ee56343ba864fe8b2a57d3eff7',
          spanId: 'e457b5a2e4d86bd1',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        });
      });

      it('should handle x-b3-sampled: true', () => {
        const headers = {
          'x-b3-traceid': '80f198ee56343ba864fe8b2a57d3eff7',
          'x-b3-spanid': 'e457b5a2e4d86bd1',
          'x-b3-sampled': 'true',
        };

        const context = b3ContextExtractor(headers);

        expect(context?.traceFlags).toBe(TraceFlags.SAMPLED);
      });

      it('should handle x-b3-sampled: false', () => {
        const headers = {
          'x-b3-traceid': '80f198ee56343ba864fe8b2a57d3eff7',
          'x-b3-spanid': 'e457b5a2e4d86bd1',
          'x-b3-sampled': 'false',
        };

        const context = b3ContextExtractor(headers);

        expect(context?.traceFlags).toBe(TraceFlags.NONE);
      });

      it('should default to sampled when sampled header missing', () => {
        const headers = {
          'x-b3-traceid': '80f198ee56343ba864fe8b2a57d3eff7',
          'x-b3-spanid': 'e457b5a2e4d86bd1',
        };

        const context = b3ContextExtractor(headers);

        expect(context?.traceFlags).toBe(TraceFlags.SAMPLED);
      });

      it('should return null when trace ID missing', () => {
        const headers = {
          'x-b3-spanid': 'e457b5a2e4d86bd1',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toBeNull();
      });

      it('should return null when span ID missing', () => {
        const headers = {
          'x-b3-traceid': '80f198ee56343ba864fe8b2a57d3eff7',
        };

        const context = b3ContextExtractor(headers);

        expect(context).toBeNull();
      });
    });

    it('should pad short trace IDs', () => {
      const headers = {
        'x-b3-traceid': 'abc123',
        'x-b3-spanid': 'def456',
      };

      const context = b3ContextExtractor(headers);

      expect(context?.traceId).toBe('00000000000000000000000000abc123'); // 32 hex chars
      expect(context?.spanId).toBe('0000000000def456'); // 16 hex chars
    });
  });

  describe('xrayContextExtractor', () => {
    it('should extract AWS X-Ray trace context', () => {
      const headers = {
        'x-amzn-trace-id':
          'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1',
      };

      const context = xrayContextExtractor(headers);

      expect(context).toEqual({
        traceId: '5759e988bd862e3fe1be46a994272793',
        spanId: '53995c3f42cd8ad8',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
      });
    });

    it('should handle unsampled X-Ray traces', () => {
      const headers = {
        'x-amzn-trace-id':
          'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=0',
      };

      const context = xrayContextExtractor(headers);

      expect(context).toEqual({
        traceId: '5759e988bd862e3fe1be46a994272793',
        spanId: '53995c3f42cd8ad8',
        traceFlags: TraceFlags.NONE,
        isRemote: true,
      });
    });

    it('should handle case-insensitive header name', () => {
      const headers = {
        'X-Amzn-Trace-Id':
          'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1',
      };

      const context = xrayContextExtractor(headers);

      expect(context).not.toBeNull();
      expect(context?.traceId).toBe('5759e988bd862e3fe1be46a994272793');
    });

    it('should default to sampled when Sampled missing', () => {
      const headers = {
        'x-amzn-trace-id':
          'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8',
      };

      const context = xrayContextExtractor(headers);

      expect(context?.traceFlags).toBe(TraceFlags.SAMPLED);
    });

    it('should return null when header missing', () => {
      const headers = {};

      const context = xrayContextExtractor(headers);

      expect(context).toBeNull();
    });

    it('should return null when Root missing', () => {
      const headers = {
        'x-amzn-trace-id': 'Parent=53995c3f42cd8ad8;Sampled=1',
      };

      const context = xrayContextExtractor(headers);

      expect(context).toBeNull();
    });

    it('should return null when Parent missing', () => {
      const headers = {
        'x-amzn-trace-id': 'Root=1-5759e988-bd862e3fe1be46a994272793;Sampled=1',
      };

      const context = xrayContextExtractor(headers);

      expect(context).toBeNull();
    });
  });
});

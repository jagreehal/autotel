/**
 * Tests for semantic convention helpers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  traceLLM,
  traceDB,
  traceHTTP,
  traceMessaging,
} from './semantic-helpers';
import { createTraceCollector } from './testing';

describe('Semantic Helpers', () => {
  let collector: ReturnType<typeof createTraceCollector>;

  beforeEach(() => {
    collector = createTraceCollector();
  });

  describe('traceLLM', () => {
    it('should add Gen AI semantic convention attributes', async () => {
      const generateText = traceLLM({
        model: 'gpt-4',
        operation: 'chat',
        system: 'openai',
      })((_ctx) => async (prompt: string) => {
        return `Response to: ${prompt}`;
      });

      await generateText('Hello');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes['gen.ai.request.model']).toBe('gpt-4');
      expect(span.attributes['gen.ai.operation.name']).toBe('chat');
      expect(span.attributes['gen.ai.system']).toBe('openai');
    });

    it('should use default operation when not specified', async () => {
      const generateText = traceLLM({
        model: 'claude-3',
      })((_ctx) => async () => 'result');

      await generateText();

      const spans = collector.getSpans();
      expect(spans[0].attributes['gen.ai.operation.name']).toBe('chat');
    });

    it('should support embedding operation', async () => {
      const embed = traceLLM({
        model: 'text-embedding-3-small',
        operation: 'embedding',
        system: 'openai',
      })((_ctx) => async (_text: string) => [0.1, 0.2, 0.3]);

      await embed('test text');

      const spans = collector.getSpans();
      expect(spans[0].attributes['gen.ai.operation.name']).toBe('embedding');
    });

    it('should support additional custom attributes', async () => {
      const generateText = traceLLM({
        model: 'gpt-4',
        attributes: {
          'custom.attribute': 'custom-value',
          'custom.number': 123,
        },
      })((_ctx) => async () => 'result');

      await generateText();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['gen.ai.request.model']).toBe('gpt-4');
      expect(span.attributes['custom.attribute']).toBe('custom-value');
      expect(span.attributes['custom.number']).toBe(123);
    });
  });

  describe('traceDB', () => {
    it('should add DB semantic convention attributes', async () => {
      const getUser = traceDB({
        system: 'postgresql',
        operation: 'SELECT',
        dbName: 'app_db',
        collection: 'users',
      })((_ctx) => async (userId: string) => {
        return { id: userId, name: 'John' };
      });

      await getUser('123');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes['db.system']).toBe('postgresql');
      expect(span.attributes['db.operation']).toBe('SELECT');
      expect(span.attributes['db.name']).toBe('app_db');
      expect(span.attributes['db.collection.name']).toBe('users');
    });

    it('should work without optional attributes', async () => {
      const query = traceDB({
        system: 'mongodb',
      })((_ctx) => async () => ({ results: [] }));

      await query();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['db.system']).toBe('mongodb');
      expect(span.attributes['db.operation']).toBeUndefined();
      expect(span.attributes['db.name']).toBeUndefined();
    });

    it('should support custom attributes', async () => {
      const query = traceDB({
        system: 'redis',
        operation: 'GET',
        attributes: {
          'db.redis.ttl': 3600,
        },
      })((_ctx) => async (key: string) => `value-${key}`);

      await query('test-key');

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['db.system']).toBe('redis');
      expect(span.attributes['db.redis.ttl']).toBe(3600);
    });
  });

  describe('traceHTTP', () => {
    it('should add HTTP semantic convention attributes', async () => {
      const fetchUser = traceHTTP({
        method: 'GET',
        url: 'https://api.example.com/users/:id',
      })((_ctx) => async (userId: string) => {
        return { id: userId };
      });

      await fetchUser('123');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes['http.request.method']).toBe('GET');
      expect(span.attributes['url.full']).toBe(
        'https://api.example.com/users/:id',
      );
    });

    it('should work with only method', async () => {
      const request = traceHTTP({
        method: 'POST',
      })((_ctx) => async (_data: object) => ({ success: true }));

      await request({ test: 'data' });

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['http.request.method']).toBe('POST');
      expect(span.attributes['url.full']).toBeUndefined();
    });

    it('should work with only URL', async () => {
      const request = traceHTTP({
        url: 'https://api.example.com',
      })((_ctx) => async () => ({ success: true }));

      await request();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['url.full']).toBe('https://api.example.com');
      expect(span.attributes['http.request.method']).toBeUndefined();
    });

    it('should support custom attributes', async () => {
      const request = traceHTTP({
        method: 'POST',
        url: 'https://webhook.example.com',
        attributes: {
          'http.request.retry_count': 3,
          'http.request.timeout': 5000,
        },
      })((_ctx) => async () => ({ success: true }));

      await request();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['http.request.retry_count']).toBe(3);
      expect(span.attributes['http.request.timeout']).toBe(5000);
    });
  });

  describe('traceMessaging', () => {
    it('should add Messaging semantic convention attributes', async () => {
      const publishEvent = traceMessaging({
        system: 'kafka',
        operation: 'publish',
        destination: 'user-events',
      })((_ctx) => async (_event: object) => {
        return { messageId: '123' };
      });

      await publishEvent({ type: 'user.created' });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);

      const span = spans[0];
      expect(span.attributes['messaging.system']).toBe('kafka');
      expect(span.attributes['messaging.operation']).toBe('publish');
      expect(span.attributes['messaging.destination.name']).toBe('user-events');
    });

    it('should work with minimal config', async () => {
      const sendMessage = traceMessaging({
        system: 'rabbitmq',
      })((_ctx) => async () => ({ sent: true }));

      await sendMessage();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['messaging.system']).toBe('rabbitmq');
      expect(span.attributes['messaging.operation']).toBeUndefined();
      expect(span.attributes['messaging.destination.name']).toBeUndefined();
    });

    it('should support receive operation', async () => {
      const consumeMessage = traceMessaging({
        system: 'sqs',
        operation: 'receive',
        destination: 'notifications',
      })((_ctx) => async () => ({ messages: [] }));

      await consumeMessage();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['messaging.operation']).toBe('receive');
    });

    it('should support custom attributes', async () => {
      const publishBatch = traceMessaging({
        system: 'aws_sqs',
        operation: 'publish',
        destination: 'orders',
        attributes: {
          'messaging.batch.message_count': 10,
          'messaging.kafka.partition': 0,
        },
      })((_ctx) => async () => ({ success: true }));

      await publishBatch();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['messaging.batch.message_count']).toBe(10);
      expect(span.attributes['messaging.kafka.partition']).toBe(0);
    });
  });

  describe('Attribute merging', () => {
    it('should merge custom attributes with semantic attributes in traceLLM', async () => {
      const fn = traceLLM({
        model: 'gpt-4',
        attributes: {
          'gen.ai.request.temperature': 0.7,
          'custom.attr': 'value',
        },
      })((_ctx) => async () => 'result');

      await fn();

      const spans = collector.getSpans();
      const span = spans[0];
      expect(span.attributes['gen.ai.request.model']).toBe('gpt-4');
      expect(span.attributes['gen.ai.request.temperature']).toBe(0.7);
      expect(span.attributes['custom.attr']).toBe('value');
    });

    it('should allow custom attributes to override semantic defaults', async () => {
      const fn = traceDB({
        system: 'postgresql',
        operation: 'SELECT',
        attributes: {
          'db.operation': 'CUSTOM_OPERATION', // Override default
        },
      })((_ctx) => async () => ({ rows: [] }));

      await fn();

      const spans = collector.getSpans();
      const span = spans[0];
      // Custom attribute should win
      expect(span.attributes['db.operation']).toBe('CUSTOM_OPERATION');
    });
  });
});

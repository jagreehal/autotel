/**
 * Tests for AttributeRedactingProcessor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AttributeRedactingProcessor,
  REDACTOR_PATTERNS,
  REDACTOR_PRESETS,
  createRedactedSpan,
  type AttributeRedactorFn,
  type AttributeRedactorConfig,
} from './attribute-redacting-processor';
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Mock span processor to capture forwarded spans
 */
class MockSpanProcessor implements SpanProcessor {
  public startedSpans: Span[] = [];
  public endedSpans: ReadableSpan[] = [];
  public flushed = false;
  public shutdownCalled = false;

  onStart(span: Span): void {
    this.startedSpans.push(span);
  }

  onEnd(span: ReadableSpan): void {
    this.endedSpans.push(span);
  }

  async forceFlush(): Promise<void> {
    this.flushed = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}

/**
 * Create a mock ReadableSpan with given attributes
 */
function createMockReadableSpan(
  attributes: Record<string, unknown>,
): ReadableSpan {
  return {
    name: 'test-span',
    kind: 0,
    spanContext: () => ({
      traceId: 'trace123',
      spanId: 'span123',
      traceFlags: 1,
    }),
    startTime: [0, 0],
    endTime: [1, 0],
    status: { code: 0 },
    attributes,
    links: [],
    events: [],
    duration: [1, 0],
    ended: true,
    resource: { attributes: {} },
    instrumentationScope: { name: 'test', version: '1.0.0' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

/**
 * Create a mock mutable Span
 */
function createMockSpan(): Span {
  return {
    name: 'test-span',
    spanContext: () => ({
      traceId: 'trace123',
      spanId: 'span123',
      traceFlags: 1,
    }),
  } as unknown as Span;
}

describe('AttributeRedactingProcessor', () => {
  let mockProcessor: MockSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
  });

  describe('custom redactor function', () => {
    it('should redact attributes using custom function', () => {
      const redactor: AttributeRedactorFn = (key, value) => {
        if (key === 'password') return '[REDACTED]';
        return value;
      };
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: { redactor },
      });

      const span = createMockReadableSpan({
        password: 'secret123',
        username: 'john',
      });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0]!.attributes.password).toBe(
        '[REDACTED]',
      );
      expect(mockProcessor.endedSpans[0]!.attributes.username).toBe('john');
    });

    it('should forward span to wrapped processor', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockReadableSpan({ test: 'value' });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans).toHaveLength(1);
    });

    it('should pass through onStart unchanged', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockSpan();
      processor.onStart(span, {} as Context);

      expect(mockProcessor.startedSpans).toHaveLength(1);
    });
  });

  describe('built-in presets', () => {
    describe('default preset', () => {
      it('should redact email addresses', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          'user.email': 'john.doe@example.com',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['user.email']).toBe(
          '[REDACTED]',
        );
      });

      it('should redact phone numbers', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          'user.phone': '555-123-4567',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['user.phone']).toBe(
          '[REDACTED]',
        );
      });

      it('should redact SSNs', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          'user.ssn': '123-45-6789',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['user.ssn']).toBe(
          '[REDACTED]',
        );
      });

      it('should redact credit card numbers', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          'payment.card': '4111-1111-1111-1111',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['payment.card']).toBe(
          '[REDACTED]',
        );
      });

      it('should redact sensitive keys by name', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          password: 'mypassword123',
          secret: 'mysecret',
          token: 'abc123token',
          apiKey: 'my-api-key',
          'db.password': 'dbpass',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes.password).toBe(
          '[REDACTED]',
        );
        expect(mockProcessor.endedSpans[0]!.attributes.secret).toBe(
          '[REDACTED]',
        );
        expect(mockProcessor.endedSpans[0]!.attributes.token).toBe(
          '[REDACTED]',
        );
        expect(mockProcessor.endedSpans[0]!.attributes.apiKey).toBe(
          '[REDACTED]',
        );
        // db.password doesn't match the pattern (not exact match)
        expect(mockProcessor.endedSpans[0]!.attributes['db.password']).toBe(
          'dbpass',
        );
      });

      it('should not redact non-sensitive fields', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'default',
        });

        const span = createMockReadableSpan({
          'user.id': '12345',
          'http.method': 'GET',
          'http.url': '/api/users',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['user.id']).toBe(
          '12345',
        );
        expect(mockProcessor.endedSpans[0]!.attributes['http.method']).toBe(
          'GET',
        );
        expect(mockProcessor.endedSpans[0]!.attributes['http.url']).toBe(
          '/api/users',
        );
      });
    });

    describe('strict preset', () => {
      it('should redact Bearer tokens', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'strict',
        });

        const span = createMockReadableSpan({
          'http.header.authorization':
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        });
        processor.onEnd(span);

        expect(
          mockProcessor.endedSpans[0]!.attributes['http.header.authorization'],
        ).toBe('[REDACTED]');
      });

      it('should redact JWTs', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'strict',
        });

        const span = createMockReadableSpan({
          'auth.token':
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['auth.token']).toBe(
          '[REDACTED]',
        );
      });

      it('should redact API keys in values', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'strict',
        });

        const span = createMockReadableSpan({
          'request.query': 'apiKey=abc123def456',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes['request.query']).toBe(
          '[REDACTED]',
        );
      });
    });

    describe('pci-dss preset', () => {
      it('should redact credit card numbers', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'pci-dss',
        });

        const span = createMockReadableSpan({
          'payment.cardNumber': '4111111111111111',
        });
        processor.onEnd(span);

        expect(
          mockProcessor.endedSpans[0]!.attributes['payment.cardNumber'],
        ).toBe('[REDACTED]');
      });

      it('should redact card-related keys', () => {
        const processor = new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'pci-dss',
        });

        const span = createMockReadableSpan({
          cardNumber: '4111111111111111',
          cvv: '123',
          pan: '4111111111111111',
        });
        processor.onEnd(span);

        expect(mockProcessor.endedSpans[0]!.attributes.cardNumber).toBe(
          '[REDACTED]',
        );
        expect(mockProcessor.endedSpans[0]!.attributes.cvv).toBe('[REDACTED]');
        expect(mockProcessor.endedSpans[0]!.attributes.pan).toBe('[REDACTED]');
      });
    });
  });

  describe('custom configuration', () => {
    it('should use custom key patterns', () => {
      const config: AttributeRedactorConfig = {
        keyPatterns: [/internal_id/i],
        replacement: '***',
      };
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: config,
      });

      const span = createMockReadableSpan({
        internal_id: 'secret-internal-123',
        public_id: 'public-456',
      });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans[0]!.attributes.internal_id).toBe('***');
      expect(mockProcessor.endedSpans[0]!.attributes.public_id).toBe(
        'public-456',
      );
    });

    it('should use custom value patterns', () => {
      const config: AttributeRedactorConfig = {
        valuePatterns: [
          {
            name: 'customerId',
            pattern: /CUST-\d{8}/g,
            replacement: 'CUST-***',
          },
        ],
      };
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: config,
      });

      const span = createMockReadableSpan({
        'order.customer': 'CUST-12345678',
      });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans[0]!.attributes['order.customer']).toBe(
        'CUST-***',
      );
    });

    it('should use custom replacement string', () => {
      const config: AttributeRedactorConfig = {
        keyPatterns: [/^secret$/],
        replacement: '<<HIDDEN>>',
      };
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: config,
      });

      const span = createMockReadableSpan({
        secret: 'my-secret-value',
      });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans[0]!.attributes.secret).toBe('<<HIDDEN>>');
    });
  });

  describe('array handling', () => {
    it('should redact PII in string arrays', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockReadableSpan({
        'user.emails': ['john@example.com', 'jane@example.org'],
      });
      processor.onEnd(span);

      const redactedEmails = mockProcessor.endedSpans[0]!.attributes[
        'user.emails'
      ] as string[];
      expect(redactedEmails[0]).toBe('[REDACTED]');
      expect(redactedEmails[1]).toBe('[REDACTED]');
    });

    it('should preserve non-string array elements', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockReadableSpan({
        'request.ids': [1, 2, 3],
      });
      processor.onEnd(span);

      const ids = mockProcessor.endedSpans[0]!.attributes[
        'request.ids'
      ] as number[];
      expect(ids).toEqual([1, 2, 3]);
    });
  });

  describe('non-string values', () => {
    it('should preserve numeric values', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockReadableSpan({
        'http.status_code': 200,
        'request.duration_ms': 150.5,
      });
      processor.onEnd(span);

      expect(mockProcessor.endedSpans[0]!.attributes['http.status_code']).toBe(
        200,
      );
      expect(
        mockProcessor.endedSpans[0]!.attributes['request.duration_ms'],
      ).toBe(150.5);
    });

    it('should preserve boolean values', () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      const span = createMockReadableSpan({
        'request.authenticated': true,
        'cache.hit': false,
      });
      processor.onEnd(span);

      expect(
        mockProcessor.endedSpans[0]!.attributes['request.authenticated'],
      ).toBe(true);
      expect(mockProcessor.endedSpans[0]!.attributes['cache.hit']).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should forward original span if redactor throws (fail-open)', () => {
      const redactor: AttributeRedactorFn = () => {
        throw new Error('Redactor error');
      };
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: { redactor },
      });

      const span = createMockReadableSpan({
        'user.email': 'john@example.com',
      });
      processor.onEnd(span);

      // Should not throw and should forward original span
      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0]!.attributes['user.email']).toBe(
        'john@example.com',
      );
    });

    it('should throw for unknown preset', () => {
      expect(() => {
        new AttributeRedactingProcessor(mockProcessor, {
          redactor: 'unknown-preset' as 'default',
        });
      }).toThrow('Unknown attribute redactor preset');
    });
  });

  describe('lifecycle methods', () => {
    it('should forward forceFlush to wrapped processor', async () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      await processor.forceFlush();

      expect(mockProcessor.flushed).toBe(true);
    });

    it('should forward shutdown to wrapped processor', async () => {
      const processor = new AttributeRedactingProcessor(mockProcessor, {
        redactor: 'default',
      });

      await processor.shutdown();

      expect(mockProcessor.shutdownCalled).toBe(true);
    });
  });
});

describe('createRedactedSpan', () => {
  it('should create a proxy that intercepts attributes', () => {
    const span = createMockReadableSpan({
      password: 'secret123',
      username: 'john',
    });

    const redactor: AttributeRedactorFn = (key, value) => {
      if (key === 'password') return '[REDACTED]';
      return value;
    };

    const redactedSpan = createRedactedSpan(span, redactor);

    expect(redactedSpan.attributes.password).toBe('[REDACTED]');
    expect(redactedSpan.attributes.username).toBe('john');
  });

  it('should preserve other span properties', () => {
    const span = createMockReadableSpan({ test: 'value' });
    const redactor: AttributeRedactorFn = (_, value) => value;

    const redactedSpan = createRedactedSpan(span, redactor);

    expect(redactedSpan.name).toBe('test-span');
    expect(redactedSpan.duration).toEqual([1, 0]);
    expect(redactedSpan.spanContext().traceId).toBe('trace123');
  });

  it('should handle methods correctly', () => {
    const span = createMockReadableSpan({ test: 'value' });
    const redactor: AttributeRedactorFn = (_, value) => value;

    const redactedSpan = createRedactedSpan(span, redactor);

    // spanContext is a method that should still work
    const context = redactedSpan.spanContext();
    expect(context.traceId).toBe('trace123');
    expect(context.spanId).toBe('span123');
  });
});

describe('REDACTOR_PATTERNS', () => {
  it('should export regex patterns for advanced users', () => {
    expect(REDACTOR_PATTERNS.email).toBeInstanceOf(RegExp);
    expect(REDACTOR_PATTERNS.phone).toBeInstanceOf(RegExp);
    expect(REDACTOR_PATTERNS.ssn).toBeInstanceOf(RegExp);
    expect(REDACTOR_PATTERNS.creditCard).toBeInstanceOf(RegExp);
    expect(REDACTOR_PATTERNS.bearerToken).toBeInstanceOf(RegExp);
    expect(REDACTOR_PATTERNS.sensitiveKey).toBeInstanceOf(RegExp);
  });

  describe('pattern matching', () => {
    it('email should match email addresses', () => {
      REDACTOR_PATTERNS.email.lastIndex = 0;
      expect(REDACTOR_PATTERNS.email.test('john@example.com')).toBe(true);
      REDACTOR_PATTERNS.email.lastIndex = 0;
      expect(
        REDACTOR_PATTERNS.email.test('john.doe+test@sub.example.org'),
      ).toBe(true);
    });

    it('creditCard should match credit card numbers', () => {
      // Reset lastIndex due to global flag
      REDACTOR_PATTERNS.creditCard.lastIndex = 0;
      expect(REDACTOR_PATTERNS.creditCard.test('4111111111111111')).toBe(true);
      REDACTOR_PATTERNS.creditCard.lastIndex = 0;
      expect(REDACTOR_PATTERNS.creditCard.test('4111-1111-1111-1111')).toBe(
        true,
      );
      REDACTOR_PATTERNS.creditCard.lastIndex = 0;
      expect(REDACTOR_PATTERNS.creditCard.test('4111 1111 1111 1111')).toBe(
        true,
      );
    });

    it('ssn should match SSN patterns', () => {
      REDACTOR_PATTERNS.ssn.lastIndex = 0;
      expect(REDACTOR_PATTERNS.ssn.test('123-45-6789')).toBe(true);
      REDACTOR_PATTERNS.ssn.lastIndex = 0;
      expect(REDACTOR_PATTERNS.ssn.test('123456789')).toBe(true);
    });

    it('phone should match US phone numbers', () => {
      REDACTOR_PATTERNS.phone.lastIndex = 0;
      expect(REDACTOR_PATTERNS.phone.test('555-123-4567')).toBe(true);
      REDACTOR_PATTERNS.phone.lastIndex = 0;
      expect(REDACTOR_PATTERNS.phone.test('555.123.4567')).toBe(true);
      REDACTOR_PATTERNS.phone.lastIndex = 0;
      expect(REDACTOR_PATTERNS.phone.test('5551234567')).toBe(true);
    });
  });
});

describe('REDACTOR_PRESETS', () => {
  it('should export preset configurations for advanced users', () => {
    expect(REDACTOR_PRESETS['default']).toBeDefined();
    expect(REDACTOR_PRESETS['strict']).toBeDefined();
    expect(REDACTOR_PRESETS['pci-dss']).toBeDefined();
  });

  it('presets should have required properties', () => {
    expect(REDACTOR_PRESETS['default'].replacement).toBe('[REDACTED]');
    expect(REDACTOR_PRESETS['default'].keyPatterns).toBeDefined();
    expect(REDACTOR_PRESETS['default'].valuePatterns).toBeDefined();
  });
});

describe('edge cases', () => {
  let mockProcessor: MockSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
  });

  it('should handle empty attributes', () => {
    const processor = new AttributeRedactingProcessor(mockProcessor, {
      redactor: 'default',
    });

    const span = createMockReadableSpan({});
    processor.onEnd(span);

    expect(mockProcessor.endedSpans).toHaveLength(1);
    expect(Object.keys(mockProcessor.endedSpans[0]!.attributes)).toHaveLength(
      0,
    );
  });

  it('should handle partial email redaction in mixed content', () => {
    const processor = new AttributeRedactingProcessor(mockProcessor, {
      redactor: 'default',
    });

    const span = createMockReadableSpan({
      message: 'User john@example.com signed up',
    });
    processor.onEnd(span);

    expect(mockProcessor.endedSpans[0]!.attributes.message).toBe(
      'User [REDACTED] signed up',
    );
  });

  it('should handle multiple PII in same value', () => {
    const processor = new AttributeRedactingProcessor(mockProcessor, {
      redactor: 'default',
    });

    const span = createMockReadableSpan({
      contacts: 'Email: john@example.com, Phone: 555-123-4567',
    });
    processor.onEnd(span);

    expect(mockProcessor.endedSpans[0]!.attributes.contacts).toBe(
      'Email: [REDACTED], Phone: [REDACTED]',
    );
  });
});

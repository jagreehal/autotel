import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import {
  createAttributeRedactor,
  createSensitiveKeyTest,
  REDACTOR_PRESETS,
} from './attribute-redacting-processor';
import { createValueRedactor } from './redact-values';
import { RedactingLogRecordProcessor } from './posthog-logs';

describe('createValueRedactor', () => {
  it('keeps validation details while masking nested cards and credentials by default', () => {
    const body = {
      code: 'invalid_card',
      status: 400,
      errors: [
        {
          field: 'expiry',
          message: 'Invalid expiry date',
          card: '4111-1111-1111-1111',
          password: 'hunter2',
          email: 'jane@example.com',
          iban: 'GB33BUKB20201555555555',
        },
      ],
    };
    const original = structuredClone(body);
    expect(createValueRedactor()(body)).toEqual({
      code: 'invalid_card',
      status: 400,
      errors: [
        {
          field: 'expiry',
          message: 'Invalid expiry date',
          card: '****1111',
          password: '[REDACTED]',
          email: 'j***@***.com',
          iban: '[REDACTED]',
        },
      ],
    });
    expect(body).toEqual(original);
  });

  it('applies dotted paths and custom personal-field rules through arrays', () => {
    const redact = createValueRedactor({
      ...REDACTOR_PRESETS.strict,
      paths: ['customer.notes'],
      keyPatterns: [
        ...REDACTOR_PRESETS.strict.keyPatterns,
        /^(name|reference)$/,
      ],
    });
    expect(
      redact({
        customer: { notes: 'private', name: 'Jane Artist' },
        payments: [{ reference: 'Jane royalties', amount: 100 }],
      }),
    ).toEqual({
      customer: { notes: '[REDACTED]', name: '[REDACTED]' },
      payments: [{ reference: '[REDACTED]', amount: 100 }],
    });
  });

  it('uses custom masks and root sibling context without retaining state between calls', () => {
    const redact = createValueRedactor({
      builtins: false,
      redactor: (key, value, root) =>
        key === 'customer.account' && root?.private === true
          ? `****${String(value).slice(-4)}`
          : value,
    });
    expect(
      redact({ private: true, customer: { account: '12345678' } }),
    ).toEqual({
      private: true,
      customer: { account: '****5678' },
    });
    expect(
      redact({ private: false, customer: { account: '12345678' } }),
    ).toEqual({
      private: false,
      customer: { account: '12345678' },
    });
  });

  it('masks whole credential subtrees including bytes, with the configured replacement', () => {
    const redact = createValueRedactor({
      builtins: false,
      keyPatterns: [/^password$/],
      replacement: '<hidden>',
    });
    expect(
      redact({
        password: { nested: ['hunter2'], bytes: new Uint8Array([1, 2]) },
      }),
    ).toEqual({
      password: { nested: ['<hidden>'], bytes: '<hidden>' },
    });
  });

  it('matches the exported log pipeline for the same structured value', async () => {
    const body = {
      errors: [
        {
          card: '4111111111111111',
          email: 'ann@example.com',
          password: { nested: 'hunter2' },
        },
      ],
      status: 400,
    };
    let exported: unknown;
    const provider = new LoggerProvider({
      processors: [
        new RedactingLogRecordProcessor(
          {
            onEmit(record) {
              exported = record.body;
            },
            shutdown: () => Promise.resolve(),
            forceFlush: () => Promise.resolve(),
          },
          createAttributeRedactor('strict'),
          createSensitiveKeyTest('strict'),
        ),
      ],
    });
    try {
      provider.getLogger('test').emit({ body });
      expect(createValueRedactor('strict')(body)).toEqual(exported);
    } finally {
      await provider.shutdown();
    }
  });

  it('protects stdout when used as a Pino error serializer', () => {
    const redact = createValueRedactor('strict');
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino(
      {
        serializers: {
          err: (error: Error) => redact(pino.stdSerializers.err(error)),
        },
      },
      stream,
    );
    const error = Object.assign(new Error('Card 4111111111111111 declined'), {
      status: 400,
      body: { code: 'invalid_card', card: '4111111111111111' },
    });
    logger.error({ err: error }, 'Webhook failed');
    const entry = JSON.parse(lines.join(''));
    expect(entry.err).toMatchObject({
      type: 'Error',
      status: 400,
      message: 'Card ****1111 declined',
      body: { code: 'invalid_card', card: '****1111' },
    });
    expect(entry.err.stack).toContain('Error: Card ****1111 declined');
    expect(lines.join('')).not.toContain('4111111111111111');
    expect(error.message).toBe('Card 4111111111111111 declined');
  });

  it('cuts actual cycles while masking shared objects at each position', () => {
    const shared = { password: 'hunter2' };
    interface Cycle {
      left: typeof shared;
      right: typeof shared;
      self?: Cycle;
    }
    const cycle: Cycle = { left: shared, right: shared };
    cycle.self = cycle;
    expect(createValueRedactor()(cycle)).toEqual({
      left: { password: '[REDACTED]' },
      right: { password: '[REDACTED]' },
      self: '[Circular]',
    });
  });

  it('bounds nesting and hides unreadable values instead of returning raw input', () => {
    interface NestedValue {
      nested?: NestedValue;
      password?: string;
    }
    let deep: NestedValue = { password: 'hunter2' };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(JSON.stringify(createValueRedactor()(deep))).toContain(
      '[REDACTED: nested too deep]',
    );
    expect(JSON.stringify(createValueRedactor()(deep))).not.toContain(
      'hunter2',
    );
    expect(
      createValueRedactor()({
        get password() {
          throw new Error('unreadable');
        },
      }),
    ).toBe('[REDACTED: redaction failed]');
    expect(
      createValueRedactor({
        redactor: () => {
          throw new Error('broken');
        },
      })('private'),
    ).toBe('[REDACTED: redaction failed]');
  });

  it('preserves scalar types and rejects executable values', () => {
    const redact = createValueRedactor();
    expect(
      redact({ count: 42, enabled: true, empty: null, absent: undefined }),
    ).toEqual({ count: 42, enabled: true, empty: null, absent: undefined });
    expect(redact(() => 'private')).toBe('[REDACTED: not a log value]');
    expect(redact(Symbol('private'))).toBe('[REDACTED: not a log value]');
  });
});

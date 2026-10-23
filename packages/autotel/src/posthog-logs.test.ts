import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockBatchLogRecordProcessor = vi.fn();
const mockOTLPLogExporter = vi.fn();

vi.mock('./node-require', () => ({
  safeRequire: vi.fn((id: string) => {
    if (id === '@opentelemetry/sdk-logs') {
      return { BatchLogRecordProcessor: mockBatchLogRecordProcessor };
    }
    if (id === '@opentelemetry/exporter-logs-otlp-http') {
      return { OTLPLogExporter: mockOTLPLogExporter };
    }
    return;
  }),
}));

import type { Attributes } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { createRequire } from 'node:module';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordProcessor,
  type SdkLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  buildPostHogLogProcessors,
  RedactingLogRecordProcessor,
} from './posthog-logs';
import {
  createAttributeRedactor,
  createSensitiveKeyTest,
  type AttributeRedactorFn,
} from './attribute-redacting-processor';

describe('buildPostHogLogProcessors', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns processor when posthog.url is configured', () => {
    const result = buildPostHogLogProcessors({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test',
    });
    expect(mockBatchLogRecordProcessor).toHaveBeenCalled();
  });

  it('returns processor from POSTHOG_LOGS_URL env var', () => {
    process.env.POSTHOG_LOGS_URL =
      'https://eu.i.posthog.com/i/v1/logs?token=phc_eu';
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://eu.i.posthog.com/i/v1/logs?token=phc_eu',
    });
  });

  it('config.url takes precedence over env var', () => {
    process.env.POSTHOG_LOGS_URL = 'https://env-url.com';
    const result = buildPostHogLogProcessors({ url: 'https://config-url.com' });
    expect(result).toHaveLength(1);
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: 'https://config-url.com',
    });
  });

  it('returns empty array when no url configured', () => {
    const result = buildPostHogLogProcessors(undefined);
    expect(result).toHaveLength(0);
    expect(mockOTLPLogExporter).not.toHaveBeenCalled();
  });

  it('accepts a second stringRedactor parameter without error', () => {
    const redactor = (s: string) => s.replaceAll('secret', '***');
    const result = buildPostHogLogProcessors(
      { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test' },
      redactor,
    );
    expect(result).toHaveLength(1);
  });

  it('returns empty array when called with undefined, undefined', () => {
    const result = buildPostHogLogProcessors(undefined, undefined);
    expect(result).toHaveLength(0);
  });

  it('redacts string values inside attribute arrays before emitting', () => {
    const wrappedOnEmit = vi.fn();
    mockBatchLogRecordProcessor.mockImplementation(function () {
      return {
        onEmit: wrappedOnEmit,
        shutdown: vi.fn().mockResolvedValue(undefined),
        forceFlush: vi.fn().mockResolvedValue(undefined),
      };
    });

    const [processor] = buildPostHogLogProcessors(
      { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_test' },
      createAttributeRedactor({
        builtins: false,
        valuePatterns: [
          { name: 'secret', pattern: /secret/g, replacement: '***' },
        ],
      }),
    );

    const record = {
      body: 'ok',
      attributes: {
        tags: ['public', 'secret'],
      },
    };

    processor!.onEmit(record as any);

    expect(wrappedOnEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          tags: ['public', '***'],
        },
      }),
      undefined,
    );
  });
});

describe('RedactingLogRecordProcessor', () => {
  function redact(record: Pick<SdkLogRecord, 'body' | 'attributes'>) {
    const emitted: unknown[] = [];
    const wrapped = {
      onEmit: (logRecord: SdkLogRecord) => emitted.push(logRecord),
    } as unknown as LogRecordProcessor;
    new RedactingLogRecordProcessor(
      wrapped,
      createAttributeRedactor('default'),
      createSensitiveKeyTest('default'),
    ).onEmit(record as SdkLogRecord);
    return emitted[0] as Pick<SdkLogRecord, 'body' | 'attributes'>;
  }

  it('redacts by key, which only the span redactor did before', () => {
    expect(
      redact({ body: 'login', attributes: { password: 'hunter2' } }).attributes,
    ).toEqual({ password: '[REDACTED]' });
  });

  it('walks nested attributes, with dotted keys for the key rules', () => {
    const { attributes } = redact({
      body: 'charged',
      attributes: {
        customer: {
          name: 'Ann',
          password: 'hunter2',
          email: 'ann@example.com',
        },
        items: [{ card: '4111 1111 1111 1111' }, 'plain', 3],
        amount: 42,
      },
    });

    expect(attributes.customer).toEqual({
      name: 'Ann',
      password: '[REDACTED]',
      email: expect.not.stringContaining('ann@example.com'),
    });
    expect(JSON.stringify(attributes.items)).not.toContain(
      '4111 1111 1111 1111',
    );
    expect((attributes.items as unknown[]).slice(1)).toEqual(['plain', 3]);
    expect(attributes.amount).toBe(42);
  });

  it('walks an object body', () => {
    const { body } = redact({
      body: { message: 'reset', token: 'abc123', contact: 'ann@example.com' },
      attributes: {},
    });

    expect(body).toMatchObject({ message: 'reset', token: '[REDACTED]' });
    expect(JSON.stringify(body)).not.toContain('ann@example.com');
  });

  it('still redacts values in a string body', () => {
    expect(
      redact({ body: 'mail ann@example.com', attributes: {} }).body,
    ).not.toContain('ann@example.com');
  });

  it('redacts everything under a sensitive key, not just matching leaves', () => {
    expect(
      redact({
        body: 'x',
        attributes: { password: { value: 'hunter2', history: ['a', 'b'] } },
      }).attributes,
    ).toEqual({
      password: { value: '[REDACTED]', history: ['[REDACTED]', '[REDACTED]'] },
    });
  });

  it("masks bytes under a sensitive key, its own or an ancestor's", () => {
    const secret = Buffer.from('hunter2');
    const { body, attributes } = redact({
      body: { password: secret },
      attributes: {
        token: new Uint8Array([1, 2, 3]),
        auth: { raw: secret },
        image: new Uint8Array([4, 5]),
      },
    });

    expect(body).toEqual({ password: '[REDACTED]' });
    expect(attributes).toEqual({
      token: '[REDACTED]',
      auth: { raw: '[REDACTED]' },
      image: new Uint8Array([4, 5]),
    });
  });

  it('redacts everything under a path that names an object', () => {
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      createAttributeRedactor({ builtins: false, paths: ['customer'] }),
      createSensitiveKeyTest({ builtins: false, paths: ['customer'] }),
    ).onEmit({
      body: 'x',
      attributes: { customer: { name: 'Ann', tier: 'gold' } },
    } as never);

    expect(emitted[0]?.attributes).toEqual({
      customer: { name: '[REDACTED]', tier: '[REDACTED]' },
    });
  });

  it('gives sibling-dependent rules the original values, whatever the order', () => {
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      (key, value, attributes) => {
        if (key === 'classification') return 'masked';
        if (key === 'payload' && attributes?.classification === 'private') {
          return '[REDACTED]';
        }
        return value;
      },
    ).onEmit({
      body: 'x',
      attributes: { classification: 'private', payload: 'diagnosis' },
    } as never);

    expect(emitted[0]?.attributes).toEqual({
      classification: 'masked',
      payload: '[REDACTED]',
    });
  });

  it('cuts cycles and over-deep nesting instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const shared = { email: 'ann@example.com' };
    let deep: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 40; i++) deep = { next: deep };

    const { attributes } = redact({
      body: 'x',
      attributes: { cyclic, pair: { a: shared, b: shared }, deep } as never,
    });

    expect(attributes.cyclic).toEqual({ name: 'loop', self: '[Circular]' });
    expect(JSON.stringify(attributes.pair)).not.toContain('ann@example.com');
    expect(JSON.stringify(attributes.pair)).not.toContain('[Circular]');
    expect(JSON.stringify(attributes.deep)).toContain(
      '[REDACTED: nested too deep]',
    );
  });

  it('fails closed when a redactor throws, and still forwards the record', () => {
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      () => {
        throw new Error('bad rule');
      },
    ).onEmit({
      body: 'card 4111111111111111',
      attributes: { pan: '4111111111111111' },
    } as never);

    expect(emitted[0]?.body).toBe('[REDACTED: redaction failed]');
    expect(emitted[0]?.attributes).toEqual({});
  });

  it('keeps child rules when a custom redactor transforms every value', () => {
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      (key, value) =>
        key.endsWith('password') ? '[REDACTED]' : `tag:${String(value)}`,
    ).onEmit({
      body: 'x',
      attributes: { customer: { name: 'Ann', password: 'hunter2' } },
    } as never);

    expect(emitted[0]?.attributes).toEqual({
      customer: { name: 'tag:Ann', password: '[REDACTED]' },
    });
  });

  it('lets a custom redactor declare which keys cover their whole object', () => {
    const exact = (key: string, value: unknown) =>
      key === 'password' ? '[REDACTED]' : (value as never);
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      exact,
      createSensitiveKeyTest({ redactor: exact, keyPatterns: [/^password$/] }),
    ).onEmit({
      body: 'x',
      attributes: { password: { value: 'hunter2' }, user: { id: 'u1' } },
    } as never);

    expect(emitted[0]?.attributes).toEqual({
      password: { value: '[REDACTED]' },
      user: { id: 'u1' },
    });
  });

  it('never infers key sensitivity from what a custom redactor returns', () => {
    const echo = (key: string, value: unknown) =>
      key === 'customer.password' ? '[REDACTED]' : `${key}:${String(value)}`;
    const emitted: SdkLogRecord[] = [];
    new RedactingLogRecordProcessor(
      { onEmit: (r: SdkLogRecord) => emitted.push(r) } as never,
      echo,
      createSensitiveKeyTest({ redactor: echo }),
    ).onEmit({
      body: 'x',
      attributes: { customer: { password: 'hunter2' } },
    } as never);

    expect(emitted[0]?.attributes).toEqual({
      customer: { password: '[REDACTED]' },
    });
  });

  describe('several processors on one record', () => {
    const prefix = (_key: string, value: unknown) =>
      typeof value === 'string' ? `tag:${value}` : (value as never);
    const capture = (into: SdkLogRecord[]) =>
      ({ onEmit: (r: SdkLogRecord) => into.push(r) }) as never;

    it('never redacts a value twice, and leaves the shared record as written', () => {
      const first: SdkLogRecord[] = [];
      const second: SdkLogRecord[] = [];
      const record = {
        body: 'x',
        attributes: { id: 'a1', people: [{ name: 'Ann' }] },
      } as unknown as SdkLogRecord;

      new RedactingLogRecordProcessor(capture(first), prefix).onEmit(record);
      new RedactingLogRecordProcessor(capture(second), prefix).onEmit(record);

      for (const received of [first[0]!, second[0]!]) {
        expect(received.attributes).toEqual({
          id: 'tag:a1',
          people: [{ name: 'tag:Ann' }],
        });
      }
      expect(record.attributes).toEqual({
        id: 'a1',
        people: [{ name: 'Ann' }],
      });
    });

    it('redacts with the current sibling context, never a guessed original', () => {
      // An earlier pass masks both classes, so they are indistinguishable in
      // its output; removing one in between must not resurrect a wrong
      // context for the payload rule.
      const rule = (key: string, value: unknown, attributes?: Attributes) => {
        if (key === 'classes') return ['[REDACTED]', '[REDACTED]'] as never;
        if (
          key === 'payload' &&
          (attributes?.classes as string[] | undefined)?.includes('private')
        ) {
          return '[REDACTED]';
        }
        return value as never;
      };
      const received: SdkLogRecord[] = [];
      const record = {
        body: 'x',
        attributes: { classes: ['public', 'private'], payload: 'diagnosis' },
      } as unknown as SdkLogRecord;
      const dropFirst = {
        onEmit: (r: SdkLogRecord) => {
          (r.attributes.classes as unknown[]).shift();
        },
      } as never;

      new RedactingLogRecordProcessor(dropFirst, rule).onEmit(record);
      new RedactingLogRecordProcessor(capture(received), rule).onEmit(record);

      expect(received[0]!.attributes.payload).toBe('[REDACTED]');
    });
  });

  it('passes metadata a processor sets on to the next one (real SDK)', () => {
    const received: Array<{
      severity?: number;
      text?: string;
      event?: string;
    }> = [];
    const redactor = createAttributeRedactor('default');
    const escalate = {
      onEmit: (r: SdkLogRecord) => {
        r.severityNumber = SeverityNumber.ERROR;
        r.severityText = 'ERROR';
        r.eventName = 'security.alert';
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const capture = {
      onEmit: (r: SdkLogRecord) =>
        received.push({
          severity: r.severityNumber,
          text: r.severityText,
          event: r.eventName,
        }),
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [
        new RedactingLogRecordProcessor(escalate, redactor),
        new RedactingLogRecordProcessor(capture, redactor),
      ],
    });

    provider.getLogger('t').emit({
      body: 'login failed',
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      eventName: 'auth.login',
    });

    expect(received).toEqual([
      {
        severity: SeverityNumber.ERROR,
        text: 'ERROR',
        event: 'security.alert',
      },
    ]);
  });

  it("keeps the SDK's attribute limits when writing changes back (real SDK)", () => {
    const received: Array<{ attributes: object; dropped: number }> = [];
    const redactor = createAttributeRedactor('default');
    const adds = (key: string) => ({
      onEmit: (r: SdkLogRecord) => {
        r.setAttribute(key, 'yes');
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    });
    const capture = {
      onEmit: (r: SdkLogRecord) =>
        received.push({
          attributes: { ...r.attributes },
          dropped: r.droppedAttributesCount,
        }),
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      logRecordLimits: { attributeCountLimit: 1 },
      processors: [
        new RedactingLogRecordProcessor(adds('first'), redactor),
        new RedactingLogRecordProcessor(adds('second'), redactor),
        new RedactingLogRecordProcessor(capture, redactor),
      ],
    });

    provider.getLogger('t').emit({ body: 'x' });

    expect(received).toEqual([{ attributes: { first: 'yes' }, dropped: 1 }]);
  });

  it('never shows a processor the original when its setAttribute is rejected (real SDK)', () => {
    const seen: unknown[] = [];
    const probe = {
      onEmit: (r: SdkLogRecord) => {
        // A function is not a log attribute value, so the SDK rejects it
        // and keeps the original.
        r.setAttribute('password', (() => 'x') as never);
        seen.push(r.attributes.password);
        r.setAttribute('token', 'abc123');
        seen.push(r.attributes.token);
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [
        new RedactingLogRecordProcessor(
          probe,
          createAttributeRedactor('default'),
          createSensitiveKeyTest('default'),
        ),
      ],
    });

    provider
      .getLogger('t')
      .emit({ body: 'x', attributes: { password: 'hunter2' } });

    expect(seen).toEqual(['[REDACTED]', '[REDACTED]']);
  });

  it('keeps the original of an attribute a processor sets, for sibling rules (real SDK)', () => {
    const rule = (key: string, value: unknown, attributes?: Attributes) => {
      if (key === 'classification') return 'masked';
      if (key === 'payload' && attributes?.classification === 'private') {
        return '[REDACTED]';
      }
      return value as never;
    };
    const received: unknown[] = [];
    const classify = {
      onEmit: (r: SdkLogRecord) => {
        r.setAttribute('classification', 'private');
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const capture = {
      onEmit: (r: SdkLogRecord) => received.push({ ...r.attributes }),
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [
        new RedactingLogRecordProcessor(classify, rule),
        new RedactingLogRecordProcessor(capture, rule),
      ],
    });

    provider
      .getLogger('t')
      .emit({ body: 'x', attributes: { payload: 'diagnosis' } });

    expect(received).toEqual([
      { classification: 'masked', payload: '[REDACTED]' },
    ]);
  });

  it("fails closed, without throwing into emit(), when a rule throws during a processor's setAttribute (real SDK)", () => {
    let calls = 0;
    const flaky = (_key: string, value: unknown) => {
      // The initial redaction succeeds; the one inside setAttribute throws.
      if (++calls > 1) throw new Error('bad rule');
      return value as never;
    };
    const seen: unknown[] = [];
    const sets = {
      onEmit: (r: SdkLogRecord) => {
        r.setAttribute('token', 'abc123');
        seen.push(r.attributes.token);
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [new RedactingLogRecordProcessor(sets, flaky)],
    });

    expect(() =>
      provider.getLogger('t').emit({ body: 'x', attributes: { a: '1' } }),
    ).not.toThrow();
    expect(seen).toEqual(['[REDACTED: redaction failed]']);
  });

  it("refreshes the processor's own view when its setAttribute changes the context (real SDK)", () => {
    const rule = (key: string, value: unknown, attributes?: Attributes) => {
      if (key === 'classification') return '[REDACTED]';
      if (
        (key === 'payload' || key === '') &&
        attributes?.classification === 'private'
      ) {
        return '[REDACTED]';
      }
      return value as never;
    };
    const seen: unknown[] = [];
    const classify = {
      onEmit: (r: SdkLogRecord) => {
        r.setAttribute('classification', 'private');
        seen.push({ body: r.body, ...r.attributes });
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [new RedactingLogRecordProcessor(classify, rule)],
    });

    provider
      .getLogger('t')
      .emit({ body: 'case notes', attributes: { payload: 'secret' } });

    expect(seen).toEqual([
      {
        body: '[REDACTED]',
        classification: '[REDACTED]',
        payload: '[REDACTED]',
      },
    ]);
  });

  it('refreshes untouched nested fields beside one the processor edited (real SDK)', () => {
    const rule = (key: string, value: unknown, attributes?: Attributes) =>
      key === 'payload.secret' && attributes?.classification === 'private'
        ? '[REDACTED]'
        : (value as never);
    const seen: unknown[] = [];
    const processor = {
      onEmit: (r: SdkLogRecord) => {
        (r.attributes.payload as Record<string, unknown>).tag = 'new';
        r.setAttribute('classification', 'private');
        seen.push(structuredClone(r.attributes));
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({
      processors: [new RedactingLogRecordProcessor(processor, rule)],
    });

    provider.getLogger('t').emit({
      body: 'x',
      attributes: { payload: { secret: 'hunter2', tag: 'old' } },
    });

    expect(seen).toEqual([
      {
        payload: { secret: '[REDACTED]', tag: 'new' },
        classification: 'private',
      },
    ]);
  });
});

/**
 * The view's contract, end to end through the real SDK: what a processor
 * changes through the record's API reaches the next processor redacted; what
 * it mutates directly stays in its own view; a redaction is never undone
 * within a record; and nothing throws into `logger.emit()`.
 */
describe('RedactingLogRecordProcessor contract (real SDK)', () => {
  type Seen = { body: unknown; attributes: Record<string, unknown> };
  const proc = (onEmit: (r: SdkLogRecord) => void) => ({
    onEmit,
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  });
  const snapshot = (r: SdkLogRecord): Seen => ({
    body: structuredClone(r.body),
    attributes: structuredClone({ ...r.attributes }),
  });

  /** Emit one record through processors, each wrapped with the same rules. */
  function run(
    steps: Array<(r: SdkLogRecord) => void>,
    record: Parameters<ReturnType<LoggerProvider['getLogger']>['emit']>[0],
    redact: AttributeRedactorFn = createAttributeRedactor('default'),
    keys = createSensitiveKeyTest('default'),
  ) {
    const seen: Seen[] = [];
    const provider = new LoggerProvider({
      processors: [
        ...steps.map(
          (step) => new RedactingLogRecordProcessor(proc(step), redact, keys),
        ),
        new RedactingLogRecordProcessor(
          proc((r) => seen.push(snapshot(r))),
          redact,
          keys,
        ),
      ],
    });
    provider.getLogger('t').emit(record);
    return seen[0]!;
  }

  it('passes on what a processor adds through setAttribute(s), redacted', () => {
    const seen = run(
      [
        (r) => {
          r.setAttribute('password', 'hunter2');
          r.setAttributes({ note: 'mail ann@example.com', region: 'eu' });
        },
      ],
      { body: 'x', attributes: { email: 'bob@example.com' } },
    );
    expect(seen.attributes.password).toBe('[REDACTED]');
    expect(JSON.stringify(seen.attributes)).not.toMatch(
      /hunter2|ann@example\.com|bob@example\.com/,
    );
    expect(seen.attributes.region).toBe('eu');
  });

  it('re-redacts with context a processor adds through setAttribute', () => {
    const seen = run([(r) => r.setAttribute('db.system.name', 'mongodb')], {
      body: 'q',
      attributes: {
        'db.query.text':
          '{ "find": "users", "filter": { "_id": "private-id" } }',
      },
    });
    expect(String(seen.attributes['db.query.text'])).not.toContain(
      'private-id',
    );
  });

  it('keeps direct mutation of the view local to that processor', () => {
    let own: Seen | undefined;
    const seen = run(
      [
        (r) => {
          r.attributes.region = 'eu';
          (r.attributes.customer as Record<string, unknown>).tier = 'gold';
          delete r.attributes.keep;
          own = snapshot(r);
        },
      ],
      { body: 'x', attributes: { customer: { name: 'Ann' }, keep: 'yes' } },
    );
    expect(own!.attributes).toEqual({
      customer: { name: 'Ann', tier: 'gold' },
      region: 'eu',
    });
    expect(seen.attributes).toEqual({ customer: { name: 'Ann' }, keep: 'yes' });
  });

  it('never undoes a redaction when context is replaced from a masked view', () => {
    const rule: AttributeRedactorFn = (key, value, attributes) => {
      if (key === 'classes') return ['[REDACTED]', '[REDACTED]'];
      if (
        key === 'payload' &&
        (attributes?.classes as string[] | undefined)?.includes('private')
      ) {
        return '[REDACTED]';
      }
      return value;
    };
    const seen = run(
      [
        // Derived from the masked view, so the 'private' entry is lost.
        (r) =>
          r.setAttribute(
            'classes',
            (r.attributes.classes as string[]).slice(1),
          ),
      ],
      {
        body: 'x',
        attributes: { classes: ['public', 'private'], payload: 'diagnosis' },
      },
      rule,
      () => false,
    );
    expect(seen.attributes.payload).toBe('[REDACTED]');
  });

  it('never undoes a redaction when a processor declassifies the record', () => {
    const rule: AttributeRedactorFn = (key, value, attributes) =>
      key === 'payload' && attributes?.classification === 'private'
        ? '[REDACTED]'
        : value;
    const seen = run(
      [(r) => r.setAttribute('classification', 'public')],
      {
        body: 'x',
        attributes: { classification: 'private', payload: 'diagnosis' },
      },
      rule,
      () => false,
    );
    expect(seen.attributes.payload).toBe('[REDACTED]');
  });

  it('never undoes a redaction of bytes when a processor declassifies the record', () => {
    const rule: AttributeRedactorFn = (key, value, attributes) =>
      key === 'payload' && attributes?.classification === 'private'
        ? '[REDACTED]'
        : value;
    const seen = run(
      [(r) => r.setAttribute('classification', 'public')],
      {
        body: { payload: new Uint8Array([1, 2, 3]) },
        attributes: { classification: 'private' },
      },
      rule,
      () => false,
    );
    expect(seen.body).toEqual({ payload: '[REDACTED]' });
  });

  it('passes a new body on through setBody or the body setter', () => {
    const viaSetBody = run([(r) => r.setBody('signed in')], {
      body: 'mail ann@example.com',
    });
    const viaSetter = run(
      [
        (r) => {
          r.body = 'signed out';
        },
      ],
      { body: 'mail ann@example.com' },
    );
    expect(viaSetBody.body).toBe('signed in');
    expect(viaSetter.body).toBe('signed out');
  });

  it('keeps a body derived from a masked one masked', () => {
    const seen = run(
      [
        (r) => {
          r.body = `${String(r.body)} (api)`;
        },
      ],
      { body: 'mail ann@example.com' },
    );
    expect(String(seen.body)).not.toContain('ann@example.com');
    expect(String(seen.body)).toContain('(api)');
  });

  it('never throws into emit() over values that are not log values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let seen: Seen | undefined;
    expect(() => {
      seen = run([], {
        body: { fn: () => 1, sym: Symbol('s'), big: 10n, cyclic } as never,
      });
    }).not.toThrow();
    expect(seen!.body).toEqual({
      fn: '[REDACTED: not a log value]',
      sym: '[REDACTED: not a log value]',
      big: 10n,
      cyclic: { self: '[Circular]' },
    });
  });

  it('never throws into emit() when a rule throws, at any step', () => {
    let calls = 0;
    const flaky: AttributeRedactorFn = (_key, value) => {
      calls++;
      if (calls > 2) throw new Error('bad rule');
      return value;
    };
    let own: Seen | undefined;
    expect(() =>
      run(
        [
          (r) => {
            r.setAttribute('a', 'one');
            r.body = 'two';
            r.setAttributes({ b: 'three' });
            own = snapshot(r);
          },
        ],
        { body: 'x', attributes: { z: 'zero' } },
        flaky,
        () => false,
      ),
    ).not.toThrow();
    expect(JSON.stringify(own)).not.toMatch(/one|two|three|zero/);
  });

  it('exports redacted records with their resource, through simple and batch processors', async () => {
    // The serializer the OTLP/HTTP exporter itself uses, reached through it.
    const { JsonLogsSerializer } = createRequire(
      createRequire(import.meta.url).resolve(
        '@opentelemetry/exporter-logs-otlp-http',
      ),
    )('@opentelemetry/otlp-transformer') as {
      JsonLogsSerializer: { serializeRequest(r: unknown[]): Uint8Array };
    };
    const simple = new InMemoryLogRecordExporter();
    const batched = new InMemoryLogRecordExporter();
    const redact = createAttributeRedactor('default');
    const keys = createSensitiveKeyTest('default');
    const provider = new LoggerProvider({
      resource: resourceFromAttributes({ 'service.name': 'payments' }),
      processors: [
        new RedactingLogRecordProcessor(
          proc((r) => r.setAttribute('card', '4111 1111 1111 1111')),
          redact,
          keys,
        ),
        new RedactingLogRecordProcessor(
          new SimpleLogRecordProcessor({ exporter: simple }),
          redact,
          keys,
        ),
        new RedactingLogRecordProcessor(
          new BatchLogRecordProcessor({ exporter: batched }),
          redact,
          keys,
        ),
      ],
    });

    provider.getLogger('t').emit({
      body: 'mail ann@example.com',
      attributes: {
        password: 'hunter2',
        customer: { email: 'bob@example.com' },
      },
    });
    await provider.forceFlush();

    for (const exporter of [simple, batched]) {
      const wire = new TextDecoder().decode(
        JsonLogsSerializer.serializeRequest(exporter.getFinishedLogRecords()),
      );
      expect(wire).not.toMatch(
        /hunter2|ann@example\.com|bob@example\.com|4111 1111 1111 1111/,
      );
      expect(wire).toContain('payments');
      expect(wire).toContain('[REDACTED]');
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instrumentBuiltInAI,
  type Instrumentation,
  type SpanApi,
} from './instrument';
import type {
  Availability,
  AwaitedMethod,
  BuiltInApi,
  BuiltInSession,
  CreateOptions,
  DownloadMonitor,
  DownloadProgressEvent,
  ModelInput,
  StreamingMethod,
} from './types';

/** The fake always installs these; a missing one is a broken test, not a case. */
const promptOf = (session: BuiltInSession): AwaitedMethod => {
  const method = session.prompt;
  if (!method) throw new Error('fake session has no prompt');
  return method;
};

const streamingOf = (session: BuiltInSession): StreamingMethod => {
  const method = session.promptStreaming;
  if (!method) throw new Error('fake session has no promptStreaming');
  return method;
};

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

let spans: RecordedSpan[];
// Every handle, released in afterEach. A test that throws mid-way would
// otherwise leave the reference count above zero, and each later install would
// quietly no-op instead of patching that test's own fake.
let handles: Instrumentation[];

/** Stand-in for autotel-web's `span()`, so these tests need no OTel pipeline. */
const recordingSpan = <T>(name: string, fn: (span: SpanApi) => T): T => {
  const entry: RecordedSpan = { name, attributes: {} };
  spans.push(entry);
  return fn({
    setAttribute: (key, value) => {
      entry.attributes[key] = value;
    },
    end: () => {},
  });
};

const spanNamed = (name: string): RecordedSpan | undefined =>
  spans.find((span) => span.name === name);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Let a span body that is awaiting a stream run to completion. */
const settled = (): Promise<void> => sleep(0);

const streamOf = (chunks: readonly string[], gapMs: number) =>
  new ReadableStream<string>({
    async start(controller) {
      for (const chunk of chunks) {
        await sleep(gapMs);
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const drain = async (stream: ReadableStream<string>): Promise<string[]> => {
  const seen: string[] = [];
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    seen.push(next.value);
  }
  return seen;
};

interface FakeOptions {
  answer?: Availability;
  availabilityError?: Error;
  answerWithOptions?: Availability;
  chunks?: readonly string[];
  contextWindow?: number;
  createError?: Error;
  downloadEvents?: readonly number[];
  gapMs?: number;
  output?: string;
  promptError?: Error;
  samplingModeReadback?: string | null;
  streamError?: Error;
}

interface Fake {
  api: BuiltInApi;
}

/**
 * Chrome's behaviour, reduced to what these tests measure. Built from the
 * probe's recordings rather than from the specification: bare and optioned
 * `availability()` can disagree, `create()` fires the download monitor whether
 * or not anything is downloaded, and `samplingMode` reads back null for the
 * raw knobs.
 */
function installFake(options: FakeOptions = {}): Fake {
  const makeSession = (created: CreateOptions | undefined): BuiltInSession => {
    const session: BuiltInSession = {
      contextUsage: 4,
      contextWindow: options.contextWindow ?? 9216,
      samplingMode:
        options.samplingModeReadback === undefined
          ? (created?.samplingMode ?? null)
          : options.samplingModeReadback,
      destroy: () => {},
      clone: () => Promise.resolve(makeSession(created)),
      prompt: async (input: ModelInput): Promise<string> => {
        if (options.promptError) throw options.promptError;
        await sleep(1);
        session.contextUsage = 32;
        return options.output ?? `answer to ${String(input)}`;
      },
      promptStreaming: (): ReadableStream<string> => {
        session.contextUsage = 32;
        if (options.streamError) {
          const failing = options.streamError;
          return new ReadableStream<string>({
            async start(controller) {
              await sleep(options.gapMs ?? 8);
              controller.enqueue('partial');
              controller.error(failing);
            },
          });
        }
        return streamOf(
          options.chunks ?? ['red', ' green', ' blue'],
          options.gapMs ?? 8,
        );
      },
    };
    return session;
  };

  const api: BuiltInApi = {
    availability: async (
      callOptions?: CreateOptions,
    ): Promise<Availability> => {
      if (options.availabilityError) throw options.availabilityError;
      return callOptions === undefined
        ? (options.answer ?? 'available')
        : (options.answerWithOptions ?? options.answer ?? 'available');
    },
    create: async (callOptions?: CreateOptions): Promise<BuiltInSession> => {
      for (const loaded of options.downloadEvents ?? []) {
        callOptions?.monitor?.({
          addEventListener: (
            _type: 'downloadprogress',
            listener: (event: DownloadProgressEvent) => void,
          ) => {
            listener({ loaded });
          },
        } satisfies DownloadMonitor);
      }
      if (options.createError) throw options.createError;
      return makeSession(callOptions);
    },
  };

  // Defined rather than assigned, for the same reason the instrumentation
  // reads them through a descriptor: no ambient declaration exists for these
  // globals, and inventing one would leak eight names into every consumer.
  Object.defineProperty(globalThis, 'LanguageModel', {
    value: api,
    configurable: true,
    writable: true,
  });
  return { api };
}

const clearGlobals = (): void => {
  for (const name of ['LanguageModel', 'Summarizer']) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
};

beforeEach(() => {
  spans = [];
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.uninstall();
  clearGlobals();
});

const install = (
  options: Partial<Parameters<typeof instrumentBuiltInAI>[0]> = {},
): Instrumentation => {
  const handle = instrumentBuiltInAI({ span: recordingSpan, ...options });
  handles.push(handle);
  return handle;
};

describe('installation', () => {
  it('does nothing when no built-in AI globals are present', () => {
    const handle = install();
    expect(spans).toHaveLength(0);
    expect(() => handle.uninstall()).not.toThrow();
  });

  it('names the globals it patched', () => {
    installFake();
    install();
    expect(spanNamed('builtin_ai.install')?.attributes).toMatchObject({
      'builtin_ai.apis': 'LanguageModel',
    });
  });

  it('restores the originals on uninstall', async () => {
    const fake = installFake();
    const originalAvailability = fake.api.availability;
    const handle = install();
    expect(fake.api.availability).not.toBe(originalAvailability);

    handle.uninstall();
    expect(fake.api.availability).toBe(originalAvailability);

    spans = [];
    await fake.api.availability();
    expect(spans).toHaveLength(0);
  });

  it('stays installed until every handle is released', () => {
    const fake = installFake();
    const first = install();
    const second = install();
    const patched = fake.api.availability;

    first.uninstall();
    expect(fake.api.availability).toBe(patched);

    second.uninstall();
    expect(fake.api.availability).not.toBe(patched);
  });

  it('honours an explicit api list', () => {
    installFake();
    install({ apis: ['Summarizer'] });
    expect(spans).toHaveLength(0);
  });
});

describe('availability', () => {
  it('records the answer and whether options were supplied', async () => {
    const fake = installFake({ answer: 'available' });
    install();

    await fake.api.availability();
    expect(spanNamed('builtin_ai.availability')?.attributes).toMatchObject({
      'builtin_ai.api': 'LanguageModel',
      'builtin_ai.availability.answer': 'available',
      'builtin_ai.availability.options_supplied': false,
      'builtin_ai.availability.sampling_option': 'none',
    });
  });

  it('records the sampling option the guard was passed', async () => {
    const fake = installFake();
    install();

    await fake.api.availability({ samplingMode: 'most-predictable' });
    expect(spanNamed('builtin_ai.availability')?.attributes).toMatchObject({
      'builtin_ai.availability.options_supplied': true,
      'builtin_ai.availability.sampling_option': 'samplingMode',
    });
  });

  // The measured trap: a guard written without options refuses on a browser
  // where create() succeeds. Both answers land on separate spans, joinable by
  // installation id.
  it('captures a bare guard disagreeing with the call it guards', async () => {
    const fake = installFake({
      answer: 'unavailable',
      answerWithOptions: 'available',
    });
    install();

    expect(await fake.api.availability()).toBe('unavailable');
    expect(
      await fake.api.availability({ samplingMode: 'most-predictable' }),
    ).toBe('available');
    await fake.api.create({ samplingMode: 'most-predictable' });

    const answers = spans
      .filter((span) => span.name === 'builtin_ai.availability')
      .map((span) => span.attributes['builtin_ai.availability.answer']);
    expect(answers).toEqual(['unavailable', 'available']);
    expect(spanNamed('create_session LanguageModel')?.attributes).toMatchObject(
      {
        'builtin_ai.create.sampling_option': 'samplingMode',
      },
    );
  });

  it('rethrows and records a failure', async () => {
    const fake = installFake({ availabilityError: new TypeError('boom') });
    install();

    await expect(fake.api.availability()).rejects.toThrow('boom');
    expect(spanNamed('builtin_ai.availability')?.attributes).toMatchObject({
      'error.type': 'TypeError',
    });
  });
});

describe('create', () => {
  it('records timing, context and the sampling option', async () => {
    const fake = installFake({ contextWindow: 9216 });
    install();

    await fake.api.create({ samplingMode: 'most-predictable' });
    const span = spanNamed('create_session LanguageModel');
    expect(span?.attributes).toMatchObject({
      'builtin_ai.api': 'LanguageModel',
      'gen_ai.operation.name': 'create_session',
      'builtin_ai.context.window': 9216,
      'builtin_ai.context.usage_at_create': 4,
      'builtin_ai.create.sampling_option': 'samplingMode',
      'builtin_ai.session.sampling_mode': 'most-predictable',
      'builtin_ai.session.sampling_mode_reported': true,
    });
    expect(span?.attributes['builtin_ai.create.ms']).toBeTypeOf('number');
  });

  // Measured: samplingMode reads back null for the raw knobs, so the session
  // cannot say how it samples and only the recorded option can.
  it('records that a session could not report its own sampling mode', async () => {
    const fake = installFake({ samplingModeReadback: null });
    install();

    await fake.api.create({ topK: 1 });
    expect(spanNamed('create_session LanguageModel')?.attributes).toMatchObject(
      {
        'builtin_ai.create.sampling_option': 'topK',
        'builtin_ai.session.sampling_mode_reported': false,
      },
    );
    expect(
      spanNamed('create_session LanguageModel')?.attributes[
        'builtin_ai.session.sampling_mode'
      ],
    ).toBeUndefined();
  });

  it('classifies the speculative decoding refusal without capturing the message', async () => {
    const fake = installFake({
      createError: Object.assign(
        new Error(
          'The sampling options are incompatible with speculative decoding (MTP).',
        ),
        { name: 'NotSupportedError' },
      ),
    });
    install();

    await expect(fake.api.create()).rejects.toThrow('speculative decoding');
    const attributes = spanNamed('create_session LanguageModel')?.attributes;
    expect(attributes).toMatchObject({
      'error.type': 'NotSupportedError',
      'builtin_ai.create.refusal': 'sampling_incompatible',
    });
    expect(attributes?.['builtin_ai.error.message']).toBeUndefined();
  });

  it('captures the message only when payload capture is on', async () => {
    const fake = installFake({
      createError: Object.assign(new Error('the service is not running'), {
        name: 'NotSupportedError',
      }),
    });
    install({ capturePayloads: true });

    await expect(fake.api.create()).rejects.toThrow();
    expect(spanNamed('create_session LanguageModel')?.attributes).toMatchObject(
      {
        'builtin_ai.create.refusal': 'service_unavailable',
        'builtin_ai.error.message': 'the service is not running',
      },
    );
  });
});

describe('downloads', () => {
  it('does not call a no-op monitor a download', async () => {
    const fake = installFake({ answer: 'available', downloadEvents: [0, 1] });
    install();

    await fake.api.availability();
    await fake.api.create();

    expect(spanNamed('create_session LanguageModel')?.attributes).toMatchObject(
      {
        'builtin_ai.availability.before': 'available',
        'builtin_ai.download.events': 2,
        'builtin_ai.download.observed': true,
        'builtin_ai.download.real': false,
        'builtin_ai.create.blocked_on_download': false,
      },
    );
  });

  it('records a real download when the model was downloadable beforehand', async () => {
    const fake = installFake({
      answer: 'downloadable',
      downloadEvents: [0.5, 1],
    });
    install();

    await fake.api.availability();
    await fake.api.create();

    expect(spanNamed('create_session LanguageModel')?.attributes).toMatchObject(
      {
        'builtin_ai.download.real': true,
        'builtin_ai.create.blocked_on_download': true,
        'builtin_ai.download.last_loaded': 1,
      },
    );
  });

  // Probing on the application's behalf would make installing telemetry add a
  // call it never made, so an undecidable answer is left off the span.
  it('omits download reality when availability was never asked', async () => {
    const fake = installFake({ downloadEvents: [0, 1] });
    install();

    await fake.api.create();
    const attributes = spanNamed('create_session LanguageModel')?.attributes;
    expect(attributes?.['builtin_ai.download.observed']).toBe(true);
    expect(attributes?.['builtin_ai.download.real']).toBeUndefined();
    expect(attributes?.['builtin_ai.availability.before']).toBeUndefined();
  });

  it("still runs the caller's own monitor", async () => {
    const fake = installFake({ downloadEvents: [0.5] });
    install();

    let seen = 0;
    await fake.api.create({
      monitor: (monitor) => {
        monitor.addEventListener('downloadprogress', () => {
          seen += 1;
        });
      },
    });
    expect(seen).toBe(1);
  });
});

describe('session work', () => {
  it('returns the model output untouched and records the call', async () => {
    const fake = installFake({ output: 'red, green, blue' });
    install();

    const session = await fake.api.create();
    expect(await promptOf(session)('Name three colours.')).toBe(
      'red, green, blue',
    );

    expect(spanNamed('prompt LanguageModel')?.attributes).toMatchObject({
      'builtin_ai.api': 'LanguageModel',
      'builtin_ai.method': 'prompt',
      'builtin_ai.streaming': false,
      'builtin_ai.input.chars': 19,
      'builtin_ai.output.chars': 16,
      'builtin_ai.context.usage_before': 4,
      'builtin_ai.context.usage_after': 32,
    });
  });

  it('keeps prompts and outputs off the span by default', async () => {
    const fake = installFake();
    install();
    const session = await fake.api.create();
    await promptOf(session)('something private');

    const attributes = spanNamed('prompt LanguageModel')?.attributes;
    expect(attributes?.['builtin_ai.input']).toBeUndefined();
    expect(attributes?.['builtin_ai.output']).toBeUndefined();
  });

  it('truncates captured payloads', async () => {
    const fake = installFake({ output: 'x'.repeat(50) });
    install({ capturePayloads: true, maxPayloadLength: 10 });
    const session = await fake.api.create();
    await promptOf(session)('y'.repeat(50));

    const attributes = spanNamed('prompt LanguageModel')?.attributes;
    expect(attributes?.['builtin_ai.input']).toBe(
      `${'y'.repeat(10)}...[50 chars]`,
    );
    expect(attributes?.['builtin_ai.output']).toBe(
      `${'x'.repeat(10)}...[50 chars]`,
    );
  });

  it('counts multimodal parts rather than characters', async () => {
    const fake = installFake();
    install();
    const session = await fake.api.create();
    await promptOf(session)([{ role: 'user' }, { role: 'user' }]);

    const attributes = spanNamed('prompt LanguageModel')?.attributes;
    expect(attributes?.['builtin_ai.input.parts']).toBe(2);
    expect(attributes?.['builtin_ai.input.chars']).toBeUndefined();
  });

  it('rethrows a failed call and records the error type', async () => {
    const fake = installFake({
      promptError: Object.assign(new Error('nope'), {
        name: 'InvalidStateError',
      }),
    });
    install();
    const session = await fake.api.create();

    await expect(promptOf(session)('hi')).rejects.toThrow('nope');
    expect(spanNamed('prompt LanguageModel')?.attributes).toMatchObject({
      'error.type': 'InvalidStateError',
    });
  });

  it('instruments a cloned session', async () => {
    const fake = installFake();
    install();
    const session = await fake.api.create();
    const clone = await session.clone?.();
    if (!clone) throw new Error('fake session has no clone');
    await promptOf(clone)('from the clone');

    // One span, and it came from the clone: an uninstrumented clone would
    // leave the conversation silent after its first fork.
    const emitted = spans.filter(
      (span) => span.name === 'prompt LanguageModel',
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.attributes['builtin_ai.context.usage_before']).toBe(4);
  });
});

describe('availability cache', () => {
  it('does not report a second download after a warm create', async () => {
    const fake = installFake({
      answer: 'downloadable',
      downloadEvents: [0, 1],
    });
    install();

    await fake.api.availability();
    await fake.api.create();
    await fake.api.create();

    const creates = spans.filter(
      (span) => span.name === 'create_session LanguageModel',
    );
    expect(creates[0]?.attributes['builtin_ai.download.real']).toBe(true);
    expect(creates[1]?.attributes['builtin_ai.availability.before']).toBe(
      'available',
    );
    expect(creates[1]?.attributes['builtin_ai.download.real']).toBe(false);
  });

  it('does not answer for options it was never asked about', async () => {
    const fake = installFake({
      answer: 'downloadable',
      downloadEvents: [0, 1],
    });
    install();

    await fake.api.availability();
    await fake.api.create({ temperature: 0.7 });

    // The bare answer says nothing about a create() made with sampling
    // options, so the download verdict is left off rather than guessed.
    const create = spanNamed('create_session LanguageModel');
    expect(
      create?.attributes['builtin_ai.availability.before'],
    ).toBeUndefined();
    expect(create?.attributes['builtin_ai.download.real']).toBeUndefined();
  });

  it('does not reuse availability across different values of one option', async () => {
    const fake = installFake({
      answer: 'downloadable',
      downloadEvents: [0, 1],
    });
    install();

    await fake.api.availability({ temperature: 0.2 });
    await fake.api.create({ temperature: 0.8 });

    const create = spanNamed('create_session LanguageModel');
    expect(
      create?.attributes['builtin_ai.availability.before'],
    ).toBeUndefined();
    expect(create?.attributes['builtin_ai.download.real']).toBeUndefined();
  });

  it('matches equivalent options even when their property order differs', async () => {
    const fake = installFake({
      answer: 'downloadable',
      downloadEvents: [0, 1],
    });
    install();

    await fake.api.availability({ topK: 2, temperature: 0.2 });
    await fake.api.create({ temperature: 0.2, topK: 2 });

    expect(
      spanNamed('create_session LanguageModel')?.attributes[
        'builtin_ai.availability.before'
      ],
    ).toBe('downloadable');
  });
});

describe('streaming', () => {
  it('hands the caller the same chunks and measures time to first token', async () => {
    const fake = installFake({ chunks: ['red', ' green', ' blue'], gapMs: 8 });
    install();
    const session = await fake.api.create();

    const seen = await drain(streamingOf(session)('Name three colours.'));
    await settled();

    expect(seen).toEqual(['red', ' green', ' blue']);
    const attributes = spanNamed('promptStreaming LanguageModel')?.attributes;
    expect(attributes).toMatchObject({
      'builtin_ai.streaming': true,
      'builtin_ai.stream.chunks': 3,
      'builtin_ai.stream.chars': 14,
    });
    const ttft = attributes?.['builtin_ai.stream.ttft_ms'];
    const total = attributes?.['builtin_ai.stream.total_ms'];
    expect(ttft).toBeTypeOf('number');
    expect(Number(ttft)).toBeLessThan(Number(total));
  });

  it('records a source stream failure instead of a successful span', async () => {
    const fake = installFake({
      streamError: Object.assign(new Error('model went away'), {
        name: 'InvalidStateError',
      }),
    });
    install();
    const session = await fake.api.create();

    await expect(drain(streamingOf(session)('go'))).rejects.toThrow(
      'model went away',
    );
    await settled();

    expect(
      spanNamed('promptStreaming LanguageModel')?.attributes,
    ).toMatchObject({ 'error.type': 'InvalidStateError' });
  });

  it('closes the span when the caller abandons the stream', async () => {
    const fake = installFake({ chunks: ['a', 'b', 'c'], gapMs: 4 });
    install();
    const session = await fake.api.create();

    const reader = streamingOf(session)('go').getReader();
    await reader.read();
    await reader.cancel();
    await settled();

    const attributes = spanNamed('promptStreaming LanguageModel')?.attributes;
    expect(attributes?.['builtin_ai.stream.chunks']).toBe(1);
    expect(attributes?.['builtin_ai.stream.total_ms']).toBeTypeOf('number');
  });
});

import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instrumentBuiltInAI,
  type InstrumentOptions,
  type Instrumentation,
} from './instrument';
import type {
  Availability,
  AwaitedMethod,
  BuiltInApi,
  BuiltInSession,
  CallOptions,
  CloneOptions,
  ContentPart,
  CreateOptions,
  DownloadMonitor,
  DownloadProgressEvent,
  Json,
  ModelInput,
  ModelOutput,
  PromptMessage,
  StreamChunk,
  StreamingMethod,
  ToolResultPart,
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

const exporter = new InMemorySpanExporter();
const tracer = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
}).getTracer('test');

const finished = (): ReadableSpan[] => exporter.getFinishedSpans();
const spanNamed = (name: string): ReadableSpan | undefined =>
  finished().find((span) => span.name === name);
const attrsOf = (name: string): Attributes | undefined =>
  spanNamed(name)?.attributes;
const spansNamed = (name: string): ReadableSpan[] =>
  finished().filter((span) => span.name === name);
const parentOf = (span: ReadableSpan | undefined): string | undefined =>
  span?.parentSpanContext?.spanId;

// Every handle, released in afterEach. A test that throws mid-way would
// otherwise leave the reference count above zero, and each later install would
// quietly no-op instead of patching that test's own fake.
let handles: Instrumentation[];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Let a span body that is awaiting a stream run to completion. */
const settled = (): Promise<void> => sleep(0);

const streamOf = (chunks: readonly StreamChunk[], gapMs: number) =>
  new ReadableStream<StreamChunk>({
    async start(controller) {
      for (const chunk of chunks) {
        await sleep(gapMs);
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const drain = async (
  stream: ReadableStream<StreamChunk>,
): Promise<StreamChunk[]> => {
  const seen: StreamChunk[] = [];
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
 * Chrome's behaviour, reduced to what these tests measure. Built from
 * measurement on Canary rather than from the specification: bare and optioned
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
      promptStreaming: (): ReadableStream<StreamChunk> => {
        session.contextUsage = 32;
        if (options.streamError) {
          const failing = options.streamError;
          return new ReadableStream<StreamChunk>({
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
  for (const name of [
    'LanguageModel',
    'Summarizer',
    'LanguageDetector',
    'SemanticEmbedder',
  ]) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
};

beforeEach(() => {
  exporter.reset();
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.uninstall();
  clearGlobals();
});

const install = (options: InstrumentOptions = {}): Instrumentation => {
  const handle = instrumentBuiltInAI({ tracer, ...options });
  handles.push(handle);
  return handle;
};

describe('installation', () => {
  it('does nothing when no built-in AI globals are present', () => {
    const handle = install();
    expect(finished()).toHaveLength(0);
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

    exporter.reset();
    await fake.api.availability();
    expect(finished()).toHaveLength(0);
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
    expect(finished()).toHaveLength(0);
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

    const answers = finished()
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
    expect(spanNamed('create_session LanguageModel')?.status).toEqual({
      code: SpanStatusCode.ERROR,
    });
    expect(spanNamed('create_session LanguageModel')?.events).toHaveLength(0);
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
      },
    );
    expect(spanNamed('create_session LanguageModel')?.status.message).toBe(
      'the service is not running',
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
    expect(attributes?.['gen_ai.input.messages']).toBeUndefined();
    expect(attributes?.['gen_ai.output.messages']).toBeUndefined();
  });

  it('caps captured payloads and keeps them valid JSON', async () => {
    const fake = installFake({ output: 'x'.repeat(500) });
    install({ capturePayloads: true, maxPayloadLength: 120 });
    const session = await fake.api.create();
    await promptOf(session)('y'.repeat(500));

    const attributes = spanNamed('prompt LanguageModel')?.attributes;
    for (const key of ['gen_ai.input.messages', 'gen_ai.output.messages']) {
      const text = String(attributes?.[key]);
      expect(text.length).toBeLessThanOrEqual(120);
      // Cut from the inside: the message, its role and part survive.
      const [message] = JSON.parse(text);
      expect(message.parts[0].content).toMatch(/\.\.\.\[500 chars\]$/);
    }
  });

  it('counts multimodal parts rather than characters', async () => {
    const fake = installFake();
    install();
    const session = await fake.api.create();
    await promptOf(session)([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);

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
    const emitted = finished().filter(
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

    const creates = finished().filter(
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
    expect(attributes?.['gen_ai.request.stream']).toBe(true);
    expect(attributes?.['gen_ai.response.finish_reasons']).toEqual(['stop']);
    const ttft = Number(attributes?.['gen_ai.response.time_to_first_chunk']);
    expect(ttft).toBeGreaterThan(0);
    const span = spanNamed('promptStreaming LanguageModel');
    const durationS = (span?.duration[0] ?? 0) + (span?.duration[1] ?? 0) / 1e9;
    expect(ttft).toBeLessThan(durationS);
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
    expect(attributes?.['builtin_ai.stream.cancelled']).toBe(true);
    expect(spanNamed('promptStreaming LanguageModel')?.status.code).not.toBe(
      SpanStatusCode.ERROR,
    );
  });
});

// ------------------------------------------- tools, sessions and context

interface ScriptedSession extends BuiltInSession {
  /** Every call's arguments, in order, as the platform received them. */
  received: Array<
    ReadonlyArray<ModelInput | CallOptions | CloneOptions | undefined>
  >;
  fire(type: string): void;
}

/**
 * One scripted answer: what a `prompt()` resolves to, or the chunks a
 * `promptStreaming()` yields. A function runs when its turn comes, so it can
 * change the session first or reject.
 */
type ScriptStep =
  | ModelOutput
  | readonly StreamChunk[]
  | (() => ModelOutput | Promise<ModelOutput>);

/**
 * A session that answers from a script, for the shapes the colour fake does
 * not cover: tool-call turns, call options, overflow events, quota fields.
 */
function installScripted(
  name: string,
  script: readonly ScriptStep[],
  extra: Partial<BuiltInSession> = {},
) {
  const sessions: ScriptedSession[] = [];
  const make = (): ScriptedSession => {
    const listeners = new Map<string, Array<() => void>>();
    let step = 0;
    const next = () => {
      const entry = script[step++] ?? '';
      return entry instanceof Function ? entry() : entry;
    };
    // SAFETY: each test writes its script for the method it calls, so a step
    // read by prompt() is an output and one read by promptStreaming() is a
    // chunk list. The union only loses which method the test had in mind.
    const nextOutput = () => next() as ModelOutput | Promise<ModelOutput>;
    // SAFETY: as above, for the streaming half.
    const nextChunks = () => next() as readonly StreamChunk[];
    const session: ScriptedSession = {
      received: [],
      contextUsage: 10,
      contextWindow: 100,
      ...extra,
      addEventListener: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: () => {},
      fire: (type) => {
        for (const listener of listeners.get(type) ?? []) listener();
      },
      prompt: async (input: ModelInput, options?: CallOptions) => {
        session.received.push([input, options]);
        await sleep(1);
        return nextOutput();
      },
      summarize: async (input: ModelInput, options?: CallOptions) => {
        session.received.push([input, options]);
        return nextOutput();
      },
      embed: async () => [0.1, 0.2],
      detect: async () => [{ detectedLanguage: 'en', confidence: 0.9 }],
      promptStreaming: (input: ModelInput, options?: CallOptions) => {
        session.received.push([input, options]);
        return streamOf(nextChunks(), 1);
      },
      clone: async (options?: CloneOptions) => {
        session.received.push([options]);
        return make();
      },
      destroy: () => {},
    };
    sessions.push(session);
    return session;
  };
  const api: BuiltInApi = {
    availability: async () => 'available',
    create: async (options?: CreateOptions) => {
      for (const loaded of [0, 0.25, 0.75, 1]) {
        if (name !== 'Summarizer') break;
        options?.monitor?.({
          addEventListener: (
            _t: 'downloadprogress',
            l: (e: DownloadProgressEvent) => void,
          ) => l({ loaded }),
        } satisfies DownloadMonitor);
      }
      return make();
    },
  };
  Object.defineProperty(globalThis, name, {
    value: api,
    configurable: true,
    writable: true,
  });
  return { api, sessions };
}

const toolCall = (callId: string, name: string, args: Json): ContentPart => ({
  type: 'tool-call',
  value: { callId, name, arguments: args },
});
const toolResponse = (
  callId: string,
  name: string,
  result: readonly ToolResultPart[],
): PromptMessage => ({
  role: 'user',
  content: [{ type: 'tool-response', value: { callId, name, result } }],
});

describe('call options', () => {
  it('forwards per-call and clone options untouched', async () => {
    const { api, sessions } = installScripted('LanguageModel', ['{"a":1}']);
    install();
    const session = await api.create();
    const signal = new AbortController().signal;
    const constraint = { type: 'object' };

    await promptOf(session)('json please', {
      responseConstraint: constraint,
      signal,
    });
    await session.clone?.({ signal });

    expect(sessions[0]?.received[0]?.[1]).toEqual({
      responseConstraint: constraint,
      signal,
    });
    expect(sessions[0]?.received[1]?.[0]).toEqual({ signal });
    expect(attrsOf('prompt LanguageModel')?.['gen_ai.output.type']).toBe(
      'json',
    );
  });
});

describe('sessions', () => {
  it('ties every span of a session to one conversation, clones included', async () => {
    const { api } = installScripted('LanguageModel', ['a', 'b']);
    install();
    const session = await api.create();
    await promptOf(session)('one');
    const clone = await session.clone?.();
    if (!clone) throw new Error('no clone');
    await promptOf(clone)('two');
    clone.destroy?.();

    const conversation = attrsOf('create_session LanguageModel')?.[
      'gen_ai.conversation.id'
    ];
    expect(conversation).toBeTypeOf('string');
    const prompts = spansNamed('prompt LanguageModel');
    expect(prompts.map((s) => s.attributes['gen_ai.conversation.id'])).toEqual([
      conversation,
      conversation,
    ]);
    expect(prompts[0]?.attributes['builtin_ai.session.id']).toBe(conversation);
    expect(prompts[1]?.attributes['builtin_ai.session.id']).not.toBe(
      conversation,
    );
    expect(prompts[1]?.attributes['builtin_ai.session.parent_id']).toBe(
      conversation,
    );
    expect(
      attrsOf('clone LanguageModel')?.['builtin_ai.clone.session_id'],
    ).toBe(prompts[1]?.attributes['builtin_ai.session.id']);
    expect(attrsOf('destroy LanguageModel')?.['builtin_ai.session.id']).toBe(
      prompts[1]?.attributes['builtin_ai.session.id'],
    );
    expect(prompts[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'google.chrome',
      'gen_ai.response.finish_reasons': ['stop'],
      'builtin_ai.turn.index': 1,
    });
  });

  it('reports context delta, remaining and utilisation', async () => {
    const { api, sessions } = installScripted('LanguageModel', [
      () => {
        const s = sessions[0];
        if (s) s.contextUsage = 40;
        return 'ok';
      },
    ]);
    install();
    await promptOf(await api.create())('hi');
    expect(attrsOf('prompt LanguageModel')).toMatchObject({
      'builtin_ai.context.usage_before': 10,
      'builtin_ai.context.usage_after': 40,
      'builtin_ai.context.usage_delta': 30,
      'builtin_ai.context.remaining': 60,
      'builtin_ai.context.utilization': 0.4,
    });
  });

  it('reads inputQuota and inputUsage on the writing-assistance APIs', async () => {
    const { api } = installScripted('Summarizer', ['short'], {
      inputQuota: 4000,
      inputUsage: 0,
    });
    // The writing-assistance APIs have no contextUsage / contextWindow.
    const strip = api.create;
    api.create = async (options) => {
      const session = await strip(options);
      delete session.contextUsage;
      delete session.contextWindow;
      return session;
    };
    install();
    const session = await api.create();
    await session.summarize?.('long text', { context: 'for a tweet' });
    expect(
      attrsOf('create_session Summarizer')?.['builtin_ai.context.window'],
    ).toBe(4000);
    expect(attrsOf('summarize Summarizer')).toMatchObject({
      'gen_ai.operation.name': 'generate_content',
      'builtin_ai.context.remaining': 4000,
    });
  });

  it('names the embedding operation and leaves detection without one', async () => {
    const { api } = installScripted('LanguageDetector', []);
    const embedder = installScripted('SemanticEmbedder', []);
    install();
    await (await api.create()).detect?.('bonjour');
    await (await embedder.api.create()).embed?.('vector me');
    expect(
      attrsOf('detect LanguageDetector')?.['gen_ai.operation.name'],
    ).toBeUndefined();
    expect(attrsOf('embed SemanticEmbedder')?.['gen_ai.operation.name']).toBe(
      'embeddings',
    );
    expect(
      attrsOf('embed SemanticEmbedder')?.['builtin_ai.output.chars'],
    ).toBeUndefined();
  });
});

describe('context overflow', () => {
  it('marks the next call when the session overflowed between calls', async () => {
    const { api, sessions } = installScripted('LanguageModel', ['a', 'b']);
    install();
    const session = await api.create();
    await promptOf(session)('one');
    sessions[0]?.fire('contextoverflow');
    await promptOf(session)('two');

    const [first, second] = spansNamed('prompt LanguageModel');
    expect(first?.attributes['builtin_ai.context.compacted']).toBeUndefined();
    expect(second?.attributes['builtin_ai.context.compacted']).toBe(true);
    expect(second?.events.map((e) => e.name)).toEqual([
      'builtin_ai.context.overflow',
    ]);
  });

  it('treats a usage drop across a call as compaction', async () => {
    const { api, sessions } = installScripted('LanguageModel', [
      () => {
        const s = sessions[0];
        if (s) s.contextUsage = 3;
        return 'a';
      },
    ]);
    install();
    await promptOf(await api.create())('one');
    expect(
      attrsOf('prompt LanguageModel')?.['builtin_ai.context.compacted'],
    ).toBe(true);
  });
});

describe('errors', () => {
  it('sets error status and calls an aborted call an abort', async () => {
    const { api } = installScripted('LanguageModel', [
      () =>
        Promise.reject(
          Object.assign(new Error('stop'), { name: 'AbortError' }),
        ),
    ]);
    install();
    await expect(promptOf(await api.create())('hi')).rejects.toThrow('stop');
    const span = spanNamed('prompt LanguageModel');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['gen_ai.response.finish_reasons']).toEqual([
      'abort',
    ]);
  });
});

describe('download progress', () => {
  it('calls fractional progress a real download without an availability answer', async () => {
    const { api } = installScripted('Summarizer', []);
    install();
    await api.create();
    const span = spanNamed('create_session Summarizer');
    expect(span?.attributes).toMatchObject({
      'builtin_ai.download.real': true,
      'builtin_ai.download.events': 4,
    });
    expect(span?.attributes['builtin_ai.download.ms']).toBeTypeOf('number');
    expect(span?.events.map((e) => e.name)).toEqual([
      'builtin_ai.download.complete',
    ]);
  });
});

describe('tool exchanges', () => {
  const tools = [
    { name: 'get_weather', description: 'Weather for a city', inputSchema: {} },
    { name: 'get_population', description: 'People in a city' },
  ];

  it('roots a tool-using question on invoke_agent with turns and tools as siblings', async () => {
    const { api } = installScripted('LanguageModel', [
      [
        toolCall('c1', 'get_weather', { city: 'Kyoto' }),
        toolCall('c2', 'get_population', { city: 'Kyoto' }),
      ],
      'Light rain; 1.4 million people.',
    ]);
    install({ capturePayloads: true });
    const session = await api.create({
      tools,
      initialPrompts: [{ role: 'system', content: 'Be brief.' }],
    });

    const first = await promptOf(session)('Weather and population of Kyoto?');
    expect(Array.isArray(first)).toBe(true);
    await sleep(5);
    await promptOf(session)([
      toolResponse('c1', 'get_weather', [
        { type: 'object', value: { sky: 'rain' } },
      ]),
      toolResponse('c2', 'get_population', [{ type: 'object', value: 1.4e6 }]),
    ]);

    const root = spanNamed('invoke_agent LanguageModel');
    const turns = spansNamed('prompt LanguageModel');
    const weather = spanNamed('execute_tool get_weather');
    const population = spanNamed('execute_tool get_population');
    const rootId = root?.spanContext().spanId;

    expect(parentOf(root)).toBeUndefined();
    for (const child of [...turns, weather, population])
      expect(parentOf(child)).toBe(rootId);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.attributes).toMatchObject({
      'gen_ai.response.finish_reasons': ['tool_call'],
      'builtin_ai.tool.call_count': 2,
      'builtin_ai.tool.call_names': ['get_weather', 'get_population'],
    });
    expect(turns[1]?.attributes).toMatchObject({
      'builtin_ai.turn.continuation': true,
      'builtin_ai.tool.response_count': 2,
    });
    expect(weather?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.call.id': 'c1',
      'gen_ai.tool.description': 'Weather for a city',
      'gen_ai.tool.call.arguments': '{"city":"Kyoto"}',
      'builtin_ai.turn.index': 1,
    });
    // The tool ran between the turns: after the first ended, before the second began.
    const ns = (t: [number, number] | undefined) => (t ? t[0] * 1e9 + t[1] : 0);
    expect(ns(weather?.startTime)).toBeGreaterThanOrEqual(
      ns(turns[0]?.endTime),
    );
    expect(ns(weather?.endTime)).toBeLessThanOrEqual(ns(turns[1]?.startTime));
    expect(ns(root?.endTime)).toBeGreaterThanOrEqual(ns(turns[1]?.endTime));

    expect(root?.attributes).toMatchObject({
      'builtin_ai.exchange.turns': 2,
      'builtin_ai.exchange.tool_calls': 2,
      'gen_ai.response.finish_reasons': ['stop'],
    });
    expect(String(root?.attributes['gen_ai.output.messages'])).toContain(
      '1.4 million',
    );
    expect(attrsOf('create_session LanguageModel')).toMatchObject({
      'gen_ai.system_instructions': '[{"type":"text","content":"Be brief."}]',
      'builtin_ai.tool.names': ['get_weather', 'get_population'],
    });
    expect(
      String(
        attrsOf('create_session LanguageModel')?.['gen_ai.tool.definitions'],
      ),
    ).toContain('Weather for a city');
  });

  it('keeps tool payloads and definitions off the span without capture', async () => {
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'get_weather', { city: 'Kyoto' })],
      'done',
    ]);
    install();
    const session = await api.create({ tools });
    await promptOf(session)('Weather?');
    await promptOf(session)([toolResponse('c1', 'get_weather', [])]);
    expect(
      attrsOf('execute_tool get_weather')?.['gen_ai.tool.call.arguments'],
    ).toBeUndefined();
    expect(
      attrsOf('create_session LanguageModel')?.['gen_ai.tool.definitions'],
    ).toBeUndefined();
    expect(
      attrsOf('execute_tool get_weather')?.['gen_ai.tool.description'],
    ).toBeUndefined();
  });

  it('abandons an exchange the page never answered', async () => {
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'get_weather', {})],
      'unrelated',
    ]);
    install();
    const session = await api.create({ tools });
    await promptOf(session)('Weather?');
    await promptOf(session)('Something else entirely');

    const roots = spansNamed('invoke_agent LanguageModel');
    expect(roots[0]?.attributes['builtin_ai.exchange.abandoned']).toBe(true);
    expect(spanNamed('execute_tool get_weather')).toBeUndefined();
  });

  it('closes an open exchange on destroy', async () => {
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'get_weather', {})],
    ]);
    install();
    const session = await api.create({ tools });
    await promptOf(session)('Weather?');
    session.destroy?.();
    expect(
      attrsOf('invoke_agent LanguageModel')?.['builtin_ai.exchange.abandoned'],
    ).toBe(true);
  });

  it('reads tool calls out of a stream and forwards every chunk untouched', async () => {
    const call = toolCall('c1', 'get_weather', { city: 'Kyoto' });
    const { api } = installScripted('LanguageModel', [['Checking', call]]);
    install();
    const session = await api.create({ tools });
    const seen = await drain(streamingOf(session)('Weather?'));
    await settled();

    expect(seen).toEqual(['Checking', call]);
    expect(attrsOf('promptStreaming LanguageModel')).toMatchObject({
      'builtin_ai.stream.chunks': 2,
      'builtin_ai.stream.chars': 8,
      'builtin_ai.tool.call_count': 1,
      'gen_ai.response.finish_reasons': ['tool_call'],
    });
  });

  it('leaves sessions without tools as a single span per call', async () => {
    const { api } = installScripted('LanguageModel', ['hi']);
    install();
    await promptOf(await api.create())('hello');
    expect(spanNamed('invoke_agent LanguageModel')).toBeUndefined();
    expect(parentOf(spanNamed('prompt LanguageModel'))).toBeUndefined();
  });
});

it('defaults to the global tracer provider', async () => {
  const { api } = installScripted('LanguageModel', ['hi']);
  const local = new InMemorySpanExporter();
  trace.setGlobalTracerProvider(
    new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: local })],
    }),
  );
  handles.push(instrumentBuiltInAI());
  await promptOf(await api.create())('hello');
  expect(local.getFinishedSpans().map((s) => s.name)).toContain(
    'prompt LanguageModel',
  );
  trace.disable();
});

describe('metrics, side methods and the device', () => {
  it('records GenAI duration and time-to-first-chunk metrics', async () => {
    const { MeterProvider, MetricReader } =
      await import('@opentelemetry/sdk-metrics');
    class Reader extends MetricReader {
      protected async onForceFlush() {}
      protected async onShutdown() {}
    }
    const reader = new Reader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter('test');
    const { api } = installScripted('LanguageModel', ['hi', ['a', 'b']]);
    install({ meter });
    const session = await api.create();
    await promptOf(session)('hello');
    await drain(streamingOf(session)('stream'));
    await settled();

    const { resourceMetrics } = await reader.collect();
    const byName = new Map(
      resourceMetrics.scopeMetrics
        .flatMap((s) => s.metrics)
        .map((m) => [m.descriptor.name, m]),
    );
    const duration = byName.get('gen_ai.client.operation.duration');
    expect(duration?.descriptor.unit).toBe('s');
    expect(
      duration?.dataPoints.map((p) => p.attributes['builtin_ai.method']).sort(),
    ).toEqual(['prompt', 'promptStreaming']);
    expect(duration?.dataPoints[0]?.attributes).toMatchObject({
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.provider.name': 'google.chrome',
    });
    expect(
      byName.get('gen_ai.client.operation.time_to_first_chunk')?.dataPoints,
    ).toHaveLength(1);
    expect(byName.get('builtin_ai.create.duration')?.dataPoints).toHaveLength(
      1,
    );
  });

  it('traces append and context measurement without opening a turn', async () => {
    const { api, sessions } = installScripted('LanguageModel', [], {
      append: async () => {
        const s = sessions[0];
        if (s) s.contextUsage = 30;
      },
      measureContextUsage: async () => 95,
    });
    install({ capturePayloads: true });
    const session = await api.create({ tools: [{ name: 't' }] });
    await session.append?.('Some background.');
    expect(await session.measureContextUsage?.('a long document')).toBe(95);

    expect(attrsOf('append LanguageModel')).toMatchObject({
      'builtin_ai.context.usage_before': 10,
      'builtin_ai.context.usage_after': 30,
      'builtin_ai.input.chars': 16,
    });
    expect(
      String(attrsOf('append LanguageModel')?.['gen_ai.input.messages']),
    ).toContain('Some background.');
    expect(attrsOf('measureContextUsage LanguageModel')).toMatchObject({
      'builtin_ai.context.measured': 95,
      'builtin_ai.context.would_overflow': true,
    });
    // Neither is a question, so neither opens a tool exchange.
    expect(spanNamed('invoke_agent LanguageModel')).toBeUndefined();
  });

  it('sets error status on a tool the page reported as failed', async () => {
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'get_weather', {})],
      'sorry',
    ]);
    install();
    const session = await api.create({ tools: [{ name: 'get_weather' }] });
    await promptOf(session)('Weather?');
    await promptOf(session)([
      {
        role: 'user',
        content: [
          {
            type: 'tool-response',
            value: {
              callId: 'c1',
              name: 'get_weather',
              errorMessage: 'offline',
            },
          },
        ],
      },
    ]);
    const tool = spanNamed('execute_tool get_weather');
    expect(tool?.status.code).toBe(SpanStatusCode.ERROR);
    expect(tool?.status.message).toBeUndefined();
    expect(tool?.attributes['error.type']).toBe('ToolError');
  });

  it('puts the device the model runs on onto every span', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { deviceMemory: 8, cpuPerformance: 3, hardwareConcurrency: 10 },
      configurable: true,
    });
    try {
      const { api } = installScripted('LanguageModel', ['hi']);
      install();
      await promptOf(await api.create())('hello');
      for (const name of [
        'create_session LanguageModel',
        'prompt LanguageModel',
      ]) {
        expect(attrsOf(name)).toMatchObject({
          'builtin_ai.runtime.device_memory_gib': 8,
          'builtin_ai.runtime.cpu_performance_tier': 3,
          'builtin_ai.runtime.logical_cores': 10,
        });
      }
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  it('exports readTurn so apps can split a tool turn from text', async () => {
    const { readTurn } = await import('./index');
    expect(
      readTurn([{ type: 'text', value: 'Checking' }, toolCall('c1', 'w', {})]),
    ).toEqual({
      text: 'Checking',
      textOnly: false,
      toolCalls: [{ id: 'c1', name: 'w', arguments: {} }],
    });
  });
});

describe('official platform rules', () => {
  it('records the user gesture state and classifies the refusal it causes', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { userActivation: { isActive: false } },
      configurable: true,
    });
    try {
      const fake = installFake({
        createError: Object.assign(
          new Error(
            'Requires a user gesture when availability is "downloading" or "downloadable".',
          ),
          { name: 'NotAllowedError' },
        ),
      });
      install();
      await expect(fake.api.create()).rejects.toThrow('user gesture');
      expect(attrsOf('create_session LanguageModel')).toMatchObject({
        'builtin_ai.create.user_activation': false,
        'builtin_ai.create.refusal': 'user_activation_required',
      });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  it('classifies a failed download', async () => {
    const fake = installFake({
      createError: Object.assign(new Error('x'), { name: 'NetworkError' }),
    });
    install();
    await expect(fake.api.create()).rejects.toThrow();
    expect(
      attrsOf('create_session LanguageModel')?.['builtin_ai.create.refusal'],
    ).toBe('download_failed');
  });
});

it('labels the provider from the browser brand, so Edge is not called Chrome', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgentData: {
        brands: [
          { brand: 'Not.A/Brand' },
          { brand: 'Chromium' },
          { brand: 'Microsoft Edge' },
        ],
      },
    },
    configurable: true,
  });
  try {
    const { api } = installScripted('LanguageModel', ['hi']);
    install();
    await promptOf(await api.create())('hello');
    expect(attrsOf('prompt LanguageModel')?.['gen_ai.provider.name']).toBe(
      'microsoft.edge',
    );
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  }
});

describe('review fixes', () => {
  it('keeps oversized tool arguments, results and definitions parseable', async () => {
    const big = {
      query: 'q'.repeat(400),
      rows: Array.from({ length: 50 }, (_, n) => n),
    };
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'search', big)],
      'done',
    ]);
    install({ capturePayloads: true, maxPayloadLength: 200 });
    const session = await api.create({
      tools: [
        { name: 'search', description: 'd'.repeat(400), inputSchema: big },
      ],
    });
    await promptOf(session)('find it');
    await promptOf(session)([
      toolResponse('c1', 'search', [{ type: 'object', value: big }]),
    ]);

    const values = [
      attrsOf('execute_tool search')?.['gen_ai.tool.call.arguments'],
      attrsOf('execute_tool search')?.['gen_ai.tool.call.result'],
      attrsOf('create_session LanguageModel')?.['gen_ai.tool.definitions'],
    ];
    for (const value of values) {
      expect(String(value).length).toBeLessThanOrEqual(200);
      expect(() => JSON.parse(String(value))).not.toThrow();
    }
  });

  it('reports an overflow that fired during a call even when usage rose', async () => {
    const { api, sessions } = installScripted('LanguageModel', [
      () => {
        const s = sessions[0];
        s?.fire('contextoverflow');
        if (s) s.contextUsage = 90; // up from 10: no drop to infer it from
        return 'a';
      },
      'b',
    ]);
    install();
    const session = await api.create();
    await promptOf(session)('one');
    await promptOf(session)('two');

    const [first, second] = spansNamed('prompt LanguageModel');
    expect(first?.events.map((e) => e.name)).toEqual([
      'builtin_ai.context.overflow',
    ]);
    expect(first?.attributes['builtin_ai.context.compacted']).toBe(true);
    // Reported once, on the call it happened in.
    expect(second?.events).toHaveLength(0);
  });
});

it('records the embedding space, the only model identity an embedder has', async () => {
  // The space Canary 159 reports, measured through SemanticEmbedder.params().
  const space = 'embeddinggemma-300m';
  const { api } = installScripted('SemanticEmbedder', [], {
    embeddingSpace: space,
  });
  install();
  const session = await api.create({ embeddingSpace: space });
  await session.embed?.('vector me');
  for (const name of [
    'create_session SemanticEmbedder',
    'embed SemanticEmbedder',
  ]) {
    expect(attrsOf(name)).toMatchObject({
      'builtin_ai.embedding.space': space,
      'gen_ai.request.model': space,
    });
  }
});

it('records the output language a session was created for', async () => {
  const { api } = installScripted('LanguageModel', []);
  const summarizer = installScripted('Summarizer', []);
  install();
  await api.create({
    expectedOutputs: [{ type: 'text', languages: ['en', 'ja'] }],
  });
  await summarizer.api.create({ outputLanguage: 'fr' });
  expect(
    attrsOf('create_session LanguageModel')?.[
      'builtin_ai.request.output_languages'
    ],
  ).toEqual(['en', 'ja']);
  expect(
    attrsOf('create_session Summarizer')?.[
      'builtin_ai.request.output_languages'
    ],
  ).toEqual(['fr']);
});

it('leaves output languages off a session created without one', async () => {
  const { api } = installScripted('LanguageModel', []);
  install();
  await api.create();
  expect(
    attrsOf('create_session LanguageModel')?.[
      'builtin_ai.request.output_languages'
    ],
  ).toBeUndefined();
});

describe('measured on Canary 159', () => {
  // A page checks availability with its options, then creates with its
  // prompts. The prompts are not part of the availability question.
  it('matches availability across the content a create adds', async () => {
    const fake = installFake({ answer: 'available', downloadEvents: [0, 1] });
    install();
    const core = { samplingMode: 'most-predictable' };
    await fake.api.availability(core);
    await fake.api.create({
      ...core,
      initialPrompts: [{ role: 'system', content: 'Be brief.' }],
    });
    expect(attrsOf('create_session LanguageModel')).toMatchObject({
      'builtin_ai.availability.before': 'available',
      'builtin_ai.download.real': false,
    });
  });

  it('counts text answered in content parts, as a tool session answers', async () => {
    const { api } = installScripted('LanguageModel', [
      [{ type: 'text', value: 'Light rain.' }],
    ]);
    install();
    await promptOf(await api.create())('Weather?');
    expect(attrsOf('prompt LanguageModel')?.['builtin_ai.output.chars']).toBe(
      11,
    );
  });
});

describe('streams and limits, as Chrome 159 behaves', () => {
  it('ends the span of a stream the platform truncates, as length', async () => {
    const truncated = Object.assign(
      new Error('The response exceeded output limits and was truncated.'),
      { name: 'QuotaExceededError' },
    );
    const fake = installFake({ streamError: truncated });
    install();
    const session = await fake.api.create();
    await expect(drain(streamingOf(session)('go'))).rejects.toThrow(
      'output limits',
    );
    await settled();
    const span = spanNamed('promptStreaming LanguageModel');
    expect(span?.attributes).toMatchObject({
      'error.type': 'QuotaExceededError',
      'gen_ai.response.finish_reasons': ['length'],
      'builtin_ai.stream.chunks': 1,
    });
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('cancels the platform stream when the caller walks away', async () => {
    let sourceCancelled: unknown;
    const { api } = installScripted('LanguageModel', []);
    const plain = api.create;
    api.create = async (options) => {
      const session = await plain(options);
      session.promptStreaming = () =>
        new ReadableStream({
          pull(controller) {
            controller.enqueue('more');
          },
          cancel(reason) {
            sourceCancelled = reason;
          },
        });
      return session;
    };
    install();
    const reader = streamingOf(await api.create())('go').getReader();
    await reader.read();
    await reader.cancel('navigated away');
    await settled();
    expect(sourceCancelled).toBe('navigated away');
    expect(
      attrsOf('promptStreaming LanguageModel')?.['builtin_ai.stream.cancelled'],
    ).toBe(true);
  });
});

it('leaves output length off a streamed turn that only asks for a tool', async () => {
  // Measured on Canary 159: the call arrives as one structured chunk.
  const call = toolCall('c1', 'get_weather', { city: 'Kyoto' });
  const { api } = installScripted('LanguageModel', [[call]]);
  install();
  const session = await api.create({ tools: [{ name: 'get_weather' }] });
  await drain(streamingOf(session)('Weather?'));
  await settled();
  const attributes = attrsOf('promptStreaming LanguageModel');
  expect(attributes?.['builtin_ai.tool.call_count']).toBe(1);
  expect(attributes?.['builtin_ai.output.chars']).toBeUndefined();
});

// A GenAI-aware backend reads gen_ai.provider.name as "a model call", so only
// model calls and the operations around them carry it.
it('marks only GenAI operations as GenAI spans', async () => {
  const { api } = installScripted('LanguageModel', ['hi'], {
    append: async () => undefined,
  });
  const detector = installScripted('LanguageDetector', []);
  install();
  await api.availability();
  const session = await api.create();
  await promptOf(session)('hello');
  await session.append?.('more');
  (await session.clone?.())?.destroy?.();
  session.destroy?.();
  await (await detector.api.create()).detect?.('bonjour');

  for (const name of ['create_session LanguageModel', 'prompt LanguageModel']) {
    expect(attrsOf(name)?.['gen_ai.provider.name']).toBe('google.chrome');
  }
  for (const name of [
    'builtin_ai.availability',
    'append LanguageModel',
    'clone LanguageModel',
    'destroy LanguageModel',
    'detect LanguageDetector',
  ]) {
    expect(attrsOf(name)?.['gen_ai.provider.name']).toBeUndefined();
    expect(attrsOf(name)?.['gen_ai.operation.name']).toBeUndefined();
  }
});

describe('exchanges across concurrency, clones and uninstall', () => {
  const weather = [{ name: 'get_weather', description: 'Weather for a city' }];
  const toolSessionOptions = { tools: weather };

  // The page may fire a second question before the first answers; Chrome
  // queues them. Each question keeps its own exchange.
  it('keeps two questions in flight on their own exchanges', async () => {
    const { api } = installScripted('LanguageModel', [
      async () => {
        await sleep(30);
        return 'A answer';
      },
      [toolCall('c1', 'get_weather', { city: 'Kyoto' })],
      'B answer',
    ]);
    install({ capturePayloads: true });
    const session = await api.create(toolSessionOptions);
    const prompt = promptOf(session);
    await Promise.all([prompt('A?'), prompt('B?')]);
    await prompt([
      toolResponse('c1', 'get_weather', [{ type: 'text', value: 'rain' }]),
    ]);

    const roots = spansNamed('invoke_agent LanguageModel');
    expect(roots).toHaveLength(2);
    const rootFor = (question: string) =>
      roots.find((s) =>
        String(s.attributes['gen_ai.input.messages']).includes(question),
      );
    expect(
      String(rootFor('A?')?.attributes['gen_ai.output.messages']),
    ).toContain('A answer');
    expect(
      String(rootFor('B?')?.attributes['gen_ai.output.messages']),
    ).toContain('B answer');
    for (const root of roots) {
      expect(root.attributes['builtin_ai.exchange.abandoned']).toBeUndefined();
    }
    const tool = spanNamed('execute_tool get_weather');
    expect(tool?.attributes['gen_ai.tool.call.arguments']).toBe(
      '{"city":"Kyoto"}',
    );
    expect(parentOf(tool)).toBe(rootFor('B?')?.spanContext().spanId);
  });

  // Forking per turn: the model asks for a tool, the page clones, and answers
  // on the clone.
  it('continues an exchange on a clone made mid-exchange', async () => {
    const { api } = installScripted('LanguageModel', [
      [toolCall('c1', 'get_weather', { city: 'Kyoto' })],
    ]);
    const plain = api.create;
    api.create = async (options) => {
      const session = await plain(options);
      session.clone = async () => ({
        contextUsage: 10,
        contextWindow: 100,
        prompt: async () => 'Light rain.',
        destroy: () => {},
      });
      return session;
    };
    install({ capturePayloads: true });
    const session = await api.create(toolSessionOptions);
    await promptOf(session)('Weather?');
    const fork = await session.clone?.();
    if (!fork) throw new Error('no clone');
    await promptOf(fork)([
      toolResponse('c1', 'get_weather', [{ type: 'text', value: 'rain' }]),
    ]);

    const root = spanNamed('invoke_agent LanguageModel');
    expect(root?.attributes['builtin_ai.exchange.abandoned']).toBeUndefined();
    expect(String(root?.attributes['gen_ai.output.messages'])).toContain(
      'Light rain.',
    );
    expect(
      attrsOf('execute_tool get_weather')?.['gen_ai.tool.call.arguments'],
    ).toBe('{"city":"Kyoto"}');
  });

  // Session methods carry no restore entry, so a dropped session is collected
  // with its wrappers; after uninstall they call the platform directly.
  it('passes session calls straight through after uninstall', async () => {
    const { api } = installScripted('LanguageModel', ['first', 'second']);
    const handle = instrumentBuiltInAI({ tracer });
    const session = await api.create();
    await promptOf(session)('one');
    handle.uninstall();
    exporter.reset();

    expect(await promptOf(session)('two')).toBe('second');
    expect(finished()).toHaveLength(0);
  });
});

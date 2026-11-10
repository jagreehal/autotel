/**
 * The shape of Chrome's built-in AI surface, as measured.
 *
 * There is no published type package for these globals, and they are late
 * bound — present only on a Chrome with the right flags. Declaring the parts
 * this instrumentation touches keeps the lookup on `globalThis` from needing
 * an assertion.
 */

/** Every answer `availability()` can give. */
export type Availability =
  'available' | 'downloadable' | 'downloading' | 'unavailable';

export const BUILTIN_AI_APIS = [
  'LanguageModel',
  'Summarizer',
  'Writer',
  'Rewriter',
  'Proofreader',
  'Translator',
  'LanguageDetector',
  'SemanticEmbedder',
] as const;

export type BuiltInApiName = (typeof BUILTIN_AI_APIS)[number];

export interface DownloadProgressEvent {
  /** Fraction complete, 0 to 1. */
  readonly loaded: number;
}

export interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: DownloadProgressEvent) => void,
  ): void;
}

/** A tool declared on a `LanguageModel` session. */
export interface ToolDeclaration {
  readonly description?: string;
  /** A JSON Schema with `type: 'object'`. */
  readonly inputSchema?: Json;
  readonly name: string;
}

/**
 * One `expectedInputs` / `expectedOutputs` entry. A type rather than an
 * interface so it is a JSON value: it is recorded as one.
 */
export type ExpectedModality = {
  readonly languages?: readonly string[];
  readonly type?: string;
};

/**
 * Create options this package reads. Everything else the caller passes is
 * forwarded untouched.
 */
export interface CreateOptions {
  expectedInputs?: readonly ExpectedModality[];
  /**
   * For `LanguageModel`, the output language goes here as a `text` entry's
   * `languages`. Canary 159 warns when it is missing: quality and safety
   * attestation suffer, and only `de, en, es, fr, ja` are supported.
   */
  expectedOutputs?: readonly ExpectedModality[];
  initialPrompts?: readonly PromptMessage[];
  monitor?: (monitor: DownloadMonitor) => void;
  /**
   * Which embedding space a `SemanticEmbedder` uses. Required on Canary 159;
   * `SemanticEmbedder.params()` lists the supported ones.
   */
  embeddingSpace?: string;
  outputLanguage?: string;
  samplingMode?: string;
  temperature?: number;
  tools?: readonly ToolDeclaration[];
  topK?: number;
}

/** A JSON value: what tool arguments and results, and schemas, are made of. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * A tool call the model asked for. Measured on Canary 159: the fields live on
 * the prototype, so `Object.keys()` sees none and `JSON.stringify()` gives
 * `{}`. Read them by name. `callId` is 16 hex characters.
 */
export interface ToolCallValue {
  readonly arguments?: Json;
  readonly callId?: string;
  readonly name?: string;
}

/** One part of a tool's result. Chrome accepts `text` and `object`. */
export interface ToolResultPart {
  readonly type: string;
  readonly value?: Json;
}

/** The page's answer to a call: a `LanguageModelToolSuccess` or `…ToolError`. */
export interface ToolResponseValue {
  readonly callId?: string;
  readonly errorMessage?: string;
  readonly name?: string;
  readonly result?: readonly ToolResultPart[];
}

/** Image or audio. Never read: recorded by modality only. */
export type MediaValue = ArrayBuffer | ArrayBufferView | Blob | ImageBitmap;

/**
 * One content part, in a prompt or in what a turn resolves to. A streamed
 * tool call arrives as one of these too, with own keys `type` and `value`.
 */
export type ContentPart =
  | {
      readonly type: 'text';
      readonly value?: string;
      readonly content?: string;
    }
  | { readonly type: 'tool-call'; readonly value: ToolCallValue }
  | { readonly type: 'tool-response'; readonly value: ToolResponseValue }
  | { readonly type: 'image' | 'audio'; readonly value?: MediaValue };

export interface PromptMessage {
  readonly content: string | readonly ContentPart[];
  readonly role?: string;
}

/** Text, one message, or a conversation. */
export type ModelInput = string | PromptMessage | readonly PromptMessage[];

/** One entry of what `LanguageDetector.detect()` resolves to. */
export interface LanguageDetection {
  readonly confidence: number;
  readonly detectedLanguage: string;
}

/** What `Proofreader.proofread()` resolves to. */
export interface ProofreadResult {
  readonly correctedInput: string;
}

/**
 * What a work method resolves to. Text from most; content parts from a
 * `LanguageModel` session with tools, even when the answer is only text
 * (measured on Canary 159); a language list from `detect()`; a vector from
 * `embed()`; a correction from `proofread()`.
 */
export type ModelOutput =
  | string
  | readonly ContentPart[]
  | readonly LanguageDetection[]
  | readonly number[]
  | Float32Array
  | ProofreadResult;

/** A streamed chunk: text, or one whole structured tool call. */
export type StreamChunk = string | ContentPart;

/** Per-call options. Only `responseConstraint` is read; all are forwarded. */
export interface CallOptions {
  /** Summarizer, Writer and Rewriter: what the input is for. */
  context?: string;
  omitResponseConstraintInput?: boolean;
  responseConstraint?: Json | RegExp;
  signal?: AbortSignal;
}

export interface CloneOptions {
  signal?: AbortSignal;
}

export type AwaitedMethod = (
  input: ModelInput,
  options?: CallOptions,
) => Promise<ModelOutput>;
export type StreamingMethod = (
  input: ModelInput,
  options?: CallOptions,
) => ReadableStream<StreamChunk>;
/** `append()` resolves to nothing; `measure*Usage()` to a token count. */
export type SideMethod = (
  input: ModelInput,
  options?: CallOptions,
) => Promise<number | undefined>;

/** A session's work methods, per API. A `*Streaming` name returns a stream. */
export const SESSION_METHODS = {
  LanguageModel: ['prompt', 'promptStreaming'],
  Summarizer: ['summarize', 'summarizeStreaming'],
  Writer: ['write', 'writeStreaming'],
  Rewriter: ['rewrite', 'rewriteStreaming'],
  Proofreader: ['proofread'],
  Translator: ['translate', 'translateStreaming'],
  LanguageDetector: ['detect'],
  SemanticEmbedder: ['embed'],
} as const satisfies Record<BuiltInApiName, readonly string[]>;

export type SessionMethodName =
  (typeof SESSION_METHODS)[BuiltInApiName][number];

/** A session from any of the built-in AI APIs. */
export type BuiltInSession = {
  [M in SessionMethodName]?: M extends `${string}Streaming`
    ? StreamingMethod
    : AwaitedMethod;
} & {
  addEventListener?: (type: string, listener: () => void) => void;
  /** Adds input to the context without asking for an answer. */
  append?: SideMethod;
  /** Tokens an input would cost. `measureInputUsage` before the rename. */
  measureContextUsage?: SideMethod;
  measureInputUsage?: SideMethod;
  removeEventListener?: (type: string, listener: () => void) => void;
  /** Forks the conversation. Returns a fresh session of the same API. */
  clone?: (options?: CloneOptions) => Promise<BuiltInSession>;
  /** Tokens spent so far. `inputUsage` on the writing-assistance APIs. */
  contextUsage?: number;
  /** Total tokens available. `inputQuota` on the writing-assistance APIs. */
  contextWindow?: number;
  destroy?: () => void;
  inputQuota?: number;
  inputUsage?: number;
  /**
   * What the session says it samples with. On Canary 159 a session created
   * with `topK` or `temperature` reads back `balanced`, since web pages ignore
   * those knobs; on 154 it read back `null`.
   */
  samplingMode?: string | null;
  /** The embedding space a `SemanticEmbedder` session embeds into. */
  embeddingSpace?: string;
};

export interface BuiltInApi {
  availability(options?: CreateOptions): Promise<Availability>;
  create(options?: CreateOptions): Promise<BuiltInSession>;
}

export const isCountable = (value: number | undefined): value is number =>
  Number.isFinite(value);

export const isBuiltInApi = (
  value: BuiltInApi | undefined,
): value is BuiltInApi =>
  value instanceof Object &&
  value.availability instanceof Function &&
  value.create instanceof Function;

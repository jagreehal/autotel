/**
 * The shape of Chrome's built-in AI surface, as measured.
 *
 * There is no published type package for these globals, and they are late
 * bound — present only on a Chrome with the right flags. Declaring the parts
 * this instrumentation touches keeps every value downstream a named domain
 * type rather than an unparsed one, and keeps the lookup on `globalThis` from
 * needing an assertion.
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

/**
 * Create options this package reads. Everything else the caller passes is
 * forwarded untouched; only the sampling knobs and the monitor are inspected.
 */
export interface CreateOptions {
  monitor?: (monitor: DownloadMonitor) => void;
  outputLanguage?: string;
  samplingMode?: string;
  temperature?: number;
  topK?: number;
}

/**
 * Multimodal input. Opaque here: nothing in this package reads inside it, and
 * the part count is the only thing worth recording about it.
 */
export interface ModelInputParts {
  readonly length: number;
}

/** What a session method accepts. Only the text form has a character count. */
export type ModelInput = ModelInputParts | string;

export type AwaitedMethod = (input: ModelInput) => Promise<string>;
export type StreamingMethod = (input: ModelInput) => ReadableStream<string>;
export type SessionMethod = AwaitedMethod | StreamingMethod;

/**
 * A session's work method. Naming them keeps the lookup in `instrument.ts` an
 * ordinary property read rather than a dictionary access over an assertion.
 */
export type SessionMethodName =
  | 'detect'
  | 'embed'
  | 'proofread'
  | 'prompt'
  | 'promptStreaming'
  | 'rewrite'
  | 'rewriteStreaming'
  | 'summarize'
  | 'summarizeStreaming'
  | 'translate'
  | 'translateStreaming'
  | 'write'
  | 'writeStreaming';

export type StreamingMethodName = Extract<
  SessionMethodName,
  `${string}Streaming`
>;

/**
 * Which method does the work, per API. A `*Streaming` name returns a stream;
 * the other returns a promise. A table rather than a branch per API, so adding
 * one is a line.
 */
export const SESSION_METHODS = {
  LanguageModel: ['prompt', 'promptStreaming'],
  Summarizer: ['summarize', 'summarizeStreaming'],
  Writer: ['write', 'writeStreaming'],
  Rewriter: ['rewrite', 'rewriteStreaming'],
  Proofreader: ['proofread'],
  Translator: ['translate', 'translateStreaming'],
  LanguageDetector: ['detect'],
  SemanticEmbedder: ['embed'],
} as const satisfies Record<BuiltInApiName, readonly SessionMethodName[]>;

/**
 * A session from any of the built-in AI APIs.
 *
 * Every work method is optional because each API exposes only its own — the
 * union is what makes `SESSION_METHODS` a lookup the compiler can check.
 */
export interface BuiltInSession {
  /** Forks the conversation. Returns a fresh session of the same API. */
  clone?: () => Promise<BuiltInSession>;
  /** Tokens spent so far. Present on `LanguageModel` sessions. */
  contextUsage?: number;
  /** Total tokens available. Present on `LanguageModel` sessions. */
  contextWindow?: number;
  destroy?: () => void;
  detect?: AwaitedMethod;
  embed?: AwaitedMethod;
  proofread?: AwaitedMethod;
  prompt?: AwaitedMethod;
  promptStreaming?: StreamingMethod;
  rewrite?: AwaitedMethod;
  rewriteStreaming?: StreamingMethod;
  /**
   * Reads back the string only when the `samplingMode` option was the one
   * used, and `null` when `topK` or `temperature` was — measured on Canary
   * 154. It reports which option was passed, not how the session samples.
   */
  samplingMode?: string | null;
  summarize?: AwaitedMethod;
  summarizeStreaming?: StreamingMethod;
  translate?: AwaitedMethod;
  translateStreaming?: StreamingMethod;
  write?: AwaitedMethod;
  writeStreaming?: StreamingMethod;
}

export interface BuiltInApi {
  availability(options?: CreateOptions): Promise<Availability>;
  create(options?: CreateOptions): Promise<BuiltInSession>;
}

/**
 * `TransformStream` gained a `cancel` hook after the lib types this package
 * builds against were written. Declaring it keeps the abandoned-stream path
 * typed instead of asserted.
 */
export interface CancellableTransformer<I, O> extends Transformer<I, O> {
  cancel?: (reason?: unknown) => void;
}

// Type guards rather than inline checks: an unparsed value gets a contract
// here, at the one boundary where the platform hands it over, and nowhere else
// in the package needs to ask what something is. None of them use `typeof` —
// an `instanceof` establishes the contract against a real constructor rather
// than against a spelling of its representation.

/** A primitive string is the text form; the multimodal form is always an object. */
export const isTextInput = (value: ModelInput): value is string =>
  !(value instanceof Object);

export const isNonEmptyString = (
  value: string | null | undefined,
): value is string => value !== null && value !== undefined && value.length > 0;

export const isCountable = (value: number | undefined): value is number =>
  Number.isFinite(value);

export const isReadableStream = (
  value: ReadableStream<string>,
): value is ReadableStream<string> => value instanceof ReadableStream;

/**
 * Generic so narrowing a method name to the streaming half narrows the method
 * with it, rather than widening both back to the union.
 */
export const isSessionMethod = <T extends SessionMethod>(
  value: T | undefined,
): value is T => value instanceof Function;

export const isCloneMethod = (
  value: (() => Promise<BuiltInSession>) | undefined,
): value is () => Promise<BuiltInSession> => value instanceof Function;

export const isBuiltInApi = (
  value: BuiltInApi | undefined,
): value is BuiltInApi =>
  value instanceof Object &&
  value.availability instanceof Function &&
  value.create instanceof Function;

/** Streaming methods are named for it, which is how the platform spells it. */
export const isStreamingMethodName = (
  method: SessionMethodName,
): method is StreamingMethodName => method.endsWith('Streaming');

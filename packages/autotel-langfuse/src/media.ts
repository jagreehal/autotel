/**
 * Base64 payloads as Langfuse media.
 *
 * An image or audio clip in a prompt arrives on the span as a `data:` URI
 * inside `gen_ai.input.messages`. Langfuse can process that server-side as a
 * fallback, but it first puts megabytes of base64 through the OTLP pipeline.
 * Langfuse recommends extracting and uploading media in the client instead.
 *
 * Langfuse's answer is a media reference: upload the bytes once, put a short
 * token where the payload was, and it renders the media and stores it out of
 * line. The upload is three calls over the same public wire API the rest of this
 * package speaks, so there is still no Langfuse SDK here:
 *
 *   1. `POST /api/public/media` — declare the content hash and get back a
 *      `mediaId` and, unless Langfuse already holds those bytes, an `uploadUrl`.
 *   2. `PUT` the bytes at `uploadUrl` (a presigned object-store URL).
 *   3. `PATCH /api/public/media/{mediaId}` — report how the upload went.
 *
 * **This cannot be a span processor.** A processor's `onEnd` is synchronous and
 * the span exports immediately after it, so there is nowhere to await an upload
 * that has to happen before the attribute is written. The `mediaId` is assigned
 * by Langfuse, not derivable from the content, so it cannot be filled in
 * optimistically either. The replacement therefore happens in application code,
 * before the attribute is set:
 *
 * @example
 * ```ts
 * import { langfuseMedia } from 'autotel-langfuse';
 *
 * const media = langfuseMedia({ baseUrl, publicKey, secretKey });
 *
 * const messages = await media.replaceDataUris(JSON.stringify(input), {
 *   traceId,
 *   field: 'input',
 * });
 * span.setAttribute('gen_ai.input.messages', messages);
 * ```
 *
 * `replaceDataUris` works on the serialised messages directly, because a `data:`
 * URI survives `JSON.stringify` unchanged. There is no need to walk the message
 * tree, and nothing to keep in step when the message shape changes.
 */

import { createHash } from 'node:crypto';

/** Which Langfuse column the media hangs off. */
export type LangfuseMediaField = 'input' | 'output' | 'metadata';

export interface LangfuseMediaOptions {
  /** Langfuse base URL, e.g. `https://cloud.langfuse.com`. */
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** Where the media belongs, which Langfuse needs before it will accept it. */
export interface LangfuseMediaTarget {
  traceId: string;
  /** Attach to a single observation rather than the whole trace. */
  observationId?: string;
  field: LangfuseMediaField;
}

export interface UploadLangfuseMediaArgs extends LangfuseMediaTarget {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * A `data:` URI, captured as content type and base64 payload.
 *
 * Deliberately narrow: only base64 payloads, which is the form every GenAI SDK
 * emits, and the only form whose bytes can be recovered without guessing a text
 * encoding. A percent-encoded `data:` URI is left alone rather than mangled.
 */
const DATA_URI = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})/g;

/** The token Langfuse swaps back for the media when it renders the trace. */
export const mediaToken = (contentType: string, mediaId: string): string =>
  `@@@langfuseMedia:type=${contentType}|id=${mediaId}|source=base64_data_uri@@@`;

interface CreateMediaResponse {
  mediaId: string;
  /** Absent when Langfuse already holds bytes with this hash. */
  uploadUrl?: string | null;
}

function isCreateMediaResponse(value: unknown): value is CreateMediaResponse {
  if (typeof value !== 'object' || value === null) return false;
  // SAFETY: the guard above established this is a non-null object; every field
  // read below is then checked for its own type before it is trusted.
  const candidate = value as Partial<CreateMediaResponse>;
  return (
    typeof candidate.mediaId === 'string' &&
    candidate.mediaId.length > 0 &&
    (candidate.uploadUrl === undefined ||
      candidate.uploadUrl === null ||
      typeof candidate.uploadUrl === 'string')
  );
}

export function langfuseMedia(options: LangfuseMediaOptions) {
  const root = options.baseUrl.replace(/\/$/, '');
  const authorization = `Basic ${Buffer.from(
    `${options.publicKey}:${options.secretKey}`,
  ).toString('base64')}`;
  const doFetch = options.fetch ?? globalThis.fetch;

  const api = async (path: string, init: RequestInit): Promise<Response> => {
    const response = await doFetch(`${root}${path}`, {
      ...init,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `[autotel-langfuse] ${init.method} ${path} failed: ${response.status} ${response.statusText}`,
      );
    }
    return response;
  };

  /**
   * Upload bytes and return the token that stands in for them.
   *
   * Rejects rather than swallowing: unlike a score, this is awaited by the
   * caller and its result is needed to build the attribute, so a failure that
   * returned a token to nothing would be worse than one that is visible.
   */
  const upload = async (args: UploadLangfuseMediaArgs): Promise<string> => {
    const sha256Hash = createHash('sha256').update(args.bytes).digest('base64');

    const response = await api('/api/public/media', {
      method: 'POST',
      body: JSON.stringify({
        traceId: args.traceId,
        // Omitted rather than sent as undefined when the media is trace-level.
        observationId: args.observationId,
        field: args.field,
        contentType: args.contentType,
        contentLength: args.bytes.byteLength,
        sha256Hash,
      }),
    });
    const created: unknown = await response.json();
    if (!isCreateMediaResponse(created)) {
      throw new Error(
        '[autotel-langfuse] POST /api/public/media returned an invalid response',
      );
    }

    // No upload URL means Langfuse already has these bytes under this hash.
    // Re-uploading them would be the only thing a retry accomplished.
    if (created.uploadUrl) {
      const startedAt = Date.now();
      const put = await doFetch(created.uploadUrl, {
        method: 'PUT',
        body: args.bytes,
        headers: {
          'Content-Type': args.contentType,
          // The object store verifies this against the body it received, so a
          // truncated upload fails here rather than becoming a corrupt asset.
          'x-amz-checksum-sha256': sha256Hash,
        },
      });

      // Report the outcome either way. Langfuse marks the record failed when
      // told, and leaves it pending forever when not, which is the state that
      // makes a broken upload look like a slow one.
      await api(`/api/public/media/${created.mediaId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          uploadedAt: new Date().toISOString(),
          uploadHttpStatus: put.status,
          // Langfuse reads this only on a failed upload; JSON.stringify drops
          // the key when the upload succeeded and it is undefined.
          uploadHttpError: put.ok
            ? undefined
            : (await put.text()).slice(0, 1000),
          uploadTimeMs: Date.now() - startedAt,
        }),
      });

      if (!put.ok) {
        throw new Error(
          `[autotel-langfuse] media upload failed: ${put.status} ${put.statusText}`,
        );
      }
    }

    return mediaToken(args.contentType, created.mediaId);
  };

  /**
   * Replace every base64 `data:` URI in `value` with a media token, uploading
   * each one. Returns `value` untouched when it holds none, so it is safe to
   * call on every attribute rather than only the ones you expect media in.
   */
  const replaceDataUris = async (
    value: string,
    target: LangfuseMediaTarget,
  ): Promise<string> => {
    const matches = [...value.matchAll(DATA_URI)];
    if (matches.length === 0) return value;

    // Identical payloads are common — the same image quoted in a follow-up
    // turn — and each upload is three round trips, so dedupe by the payload
    // before spending them rather than after.
    const unique = new Map<string, { contentType: string; base64: string }>();
    for (const [uri, contentType, base64] of matches) {
      if (uri && contentType && base64)
        unique.set(uri, { contentType, base64 });
    }

    const tokens = new Map<string, string>();
    await Promise.all(
      [...unique].map(async ([uri, { contentType, base64 }]) => {
        tokens.set(
          uri,
          await upload({
            ...target,
            contentType,
            bytes: Buffer.from(base64, 'base64'),
          }),
        );
      }),
    );

    return value.replaceAll(DATA_URI, (uri) => tokens.get(uri) ?? uri);
  };

  return { upload, replaceDataUris };
}

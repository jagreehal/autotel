import { describe, expect, it } from 'vitest';
import { langfuseMedia, mediaToken } from './media.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * A fake Langfuse that records what it was asked. Asserting on the recorded
 * calls rather than on the returned token is the point: the token is one line
 * of string building, while the three-call upload dance is the part that has to
 * match a wire API this package does not own.
 */
/** A JSON value, as this package sends and Langfuse answers with. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue };

/** One request the fake recorded, with its JSON body already parsed. */
interface RecordedCall {
  method: string;
  url: string;
  body?: JsonValue;
}

function fakeLangfuse(
  overrides: {
    uploadUrl?: string | null;
    putStatus?: number;
    createStatus?: number;
    createBody?: JsonValue;
  } = {},
) {
  const calls: RecordedCall[] = [];
  let nextId = 0;

  const fetch: typeof globalThis.fetch = async (url, init) => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    // Only the JSON calls have a parseable body; the PUT carries raw bytes,
    // which have no JSON reading.
    const raw = init?.body;
    // SAFETY: every JSON call in this package sends a string body it built with
    // JSON.stringify, so parsing one back yields a JsonValue. Byte bodies took
    // the branch above.
    const body =
      raw === undefined || raw === null || ArrayBuffer.isView(raw)
        ? undefined
        : (JSON.parse(String(raw)) as JsonValue);
    calls.push({ method, url: href, body });

    if (href.endsWith('/api/public/media') && method === 'POST') {
      const status = overrides.createStatus ?? 201;
      return new Response(
        JSON.stringify(
          overrides.createBody ?? {
            mediaId: `media-${nextId++}`,
            uploadUrl:
              overrides.uploadUrl === undefined
                ? 'https://objects.example/put'
                : overrides.uploadUrl,
          },
        ),
        { status },
      );
    }
    if (href.startsWith('https://objects.example')) {
      return new Response('', { status: overrides.putStatus ?? 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const media = langfuseMedia({
    baseUrl: 'https://langfuse.example/',
    publicKey: 'pk',
    secretKey: 'sk',
    fetch,
  });
  return { media, calls };
}

const target = { traceId: 'trace-1', field: 'input' as const };

describe('upload', () => {
  it('declares, uploads and reports, then returns the reference token', async () => {
    const { media, calls } = fakeLangfuse();
    const token = await media.upload({
      ...target,
      contentType: 'image/png',
      bytes: Buffer.from('bytes'),
    });

    expect(token).toBe(mediaToken('image/png', 'media-0'));
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /api/public/media',
      'PUT /put',
      'PATCH /api/public/media/media-0',
    ]);

    // SAFETY: the first recorded call is the JSON declaration POST, whose body
    // the fake parsed above; the assertions below are what it must contain.
    const declare = calls[0]!.body as Record<string, JsonValue>;
    expect(declare.contentLength).toBe(5);
    expect(declare.field).toBe('input');
    // base64 of sha256("bytes"), which is what Langfuse dedupes on.
    expect(declare.sha256Hash).toBe(
      'J3CJ2RwL308uaGK6fkoHYFEZQx9dE/cm3TUrBvGyBqk=',
    );
    expect(calls[2]!.body).toMatchObject({ uploadHttpStatus: 200 });
  });

  it('skips the upload when Langfuse already holds the bytes', async () => {
    // No uploadUrl means the hash is known. Re-sending the body would be the
    // only thing the round trip accomplished.
    const { media, calls } = fakeLangfuse({ uploadUrl: null });
    await media.upload({
      ...target,
      contentType: 'image/png',
      bytes: Buffer.from('bytes'),
    });
    expect(calls).toHaveLength(1);
  });

  it('reports a failed upload to Langfuse before throwing', async () => {
    // A record left pending forever is a broken upload that looks like a slow
    // one, so the PATCH has to happen even on the failing path.
    const { media, calls } = fakeLangfuse({ putStatus: 500 });
    await expect(
      media.upload({
        ...target,
        contentType: 'image/png',
        bytes: Buffer.from('bytes'),
      }),
    ).rejects.toThrow(/media upload failed: 500/);

    expect(calls.at(-1)).toMatchObject({ method: 'PATCH' });
    expect(calls.at(-1)!.body).toMatchObject({ uploadHttpStatus: 500 });
  });

  it('throws when Langfuse rejects the declaration', async () => {
    const { media } = fakeLangfuse({ createStatus: 403 });
    await expect(
      media.upload({
        ...target,
        contentType: 'image/png',
        bytes: Buffer.from('bytes'),
      }),
    ).rejects.toThrow(/POST \/api\/public\/media failed: 403/);
  });

  it('rejects a malformed declaration response instead of returning a broken token', async () => {
    const { media } = fakeLangfuse({ createBody: { uploadUrl: null } });
    await expect(
      media.upload({
        ...target,
        contentType: 'image/png',
        bytes: Buffer.from('bytes'),
      }),
    ).rejects.toThrow(/returned an invalid response/);
  });
});

describe('replaceDataUris', () => {
  it('swaps a data URI inside serialised messages for a token', async () => {
    const { media } = fakeLangfuse();
    const messages = JSON.stringify([
      { role: 'user', parts: [{ type: 'text', content: PNG }] },
    ]);

    const replaced = await media.replaceDataUris(messages, target);

    expect(replaced).toContain(mediaToken('image/png', 'media-0'));
    expect(replaced).not.toContain('base64,iVBOR');
    // Still valid JSON: the token has no characters JSON would need escaped,
    // which is the whole reason this can work on the serialised string.
    expect(() => JSON.parse(replaced)).not.toThrow();
  });

  it('uploads a repeated payload once', async () => {
    const { media, calls } = fakeLangfuse();
    const replaced = await media.replaceDataUris(
      `${PNG} and again ${PNG}`,
      target,
    );

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect([...replaced.matchAll(/@@@langfuseMedia/g)]).toHaveLength(2);
  });

  it('returns the value untouched when it holds no media', async () => {
    const { media, calls } = fakeLangfuse();
    const value = 'just a sentence about data: and base64, honestly';
    expect(await media.replaceDataUris(value, target)).toBe(value);
    expect(calls).toHaveLength(0);
  });
});

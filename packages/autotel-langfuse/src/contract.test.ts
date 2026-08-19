/**
 * The anti-drift test.
 *
 * Everything this package does is a bet about what Langfuse reads: attribute
 * names on the way in, dimension names on the way out. Unit tests only prove we
 * emit what we meant to emit, which is worth nothing if Langfuse renamed the
 * field last release. So this suite sends spans, scores and media to a real
 * Langfuse and asks its **public API** to hand them back.
 *
 * It asserts through supported surfaces on purpose, never through ClickHouse.
 * Which surfaces are available depends on the deployment, and the difference is
 * not cosmetic:
 *
 *   - **v4 self-hosted** runs in `events_only` mode. `/api/public/traces` and
 *     `/api/public/observations` 404, and `GET /api/public/v2/metrics` is the
 *     only way to read anything back.
 *   - **Langfuse Cloud** serves the entity endpoints, and rate-limits metrics to
 *     100 requests a day — which a polling loop spends in a single run.
 *
 * So metrics carries the drift alarm, which is a fixed handful of requests, and
 * the entity endpoints carry the read-back wherever they exist. Where they do
 * not, the read-back degrades to metrics and the assertions that need a
 * observation body are skipped by name rather than quietly passing.
 *
 * Run it against the stack in this repo:
 *
 * ```bash
 * docker compose -f docker/langfuse.yml up -d
 * pnpm --filter autotel-langfuse test:contract
 * ```
 *
 * Or against Langfuse Cloud:
 *
 * ```bash
 * LANGFUSE_BASE_URL=https://cloud.langfuse.com \
 * LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
 * pnpm --filter autotel-langfuse test:contract
 * ```
 *
 * Without `LANGFUSE_CONTRACT=1` the suite skips, so the normal unit run needs
 * no Docker.
 */

import { context as otelContext, trace as otelTrace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { langfuseCompatibility } from './index.js';
import { langfuseMedia } from './media.js';
import { langfuseScores } from './scores.js';

/**
 * `LANGFUSE_BASEURL` is the spelling Langfuse's own SDKs use; `LANGFUSE_BASE_URL`
 * is the spelling in this repo's `.env`. Both are accepted, because a typo here
 * silently tests localhost instead of the deployment you meant.
 */
const BASE_URL =
  process.env.LANGFUSE_BASE_URL ??
  process.env.LANGFUSE_BASEURL ??
  'http://localhost:3000';
const PUBLIC_KEY =
  process.env.LANGFUSE_PUBLIC_KEY ??
  'pk-lf-0d5c0dc9-3b4f-4f3c-9d3a-000000000001';
const SECRET_KEY =
  process.env.LANGFUSE_SECRET_KEY ??
  'sk-lf-0d5c0dc9-3b4f-4f3c-9d3a-000000000002';

const enabled = process.env.LANGFUSE_CONTRACT === '1';
const auth = `Basic ${Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64')}`;

/** Every field this package claims Langfuse stores, as metrics dimensions. */
const MAPPED_DIMENSIONS = [
  'traceName',
  'userId',
  'sessionId',
  'tags',
  'release',
  'version',
  'promptName',
  'promptVersion',
  'providedModelName',
  'type',
  'level',
] as const;

/** A 1x1 transparent PNG, small enough to inline and real enough to upload. */
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const runId = `contract-${process.pid}-${process.hrtime.bigint()}`;
const traceName = `${runId}-trace`;
const promptName = `${runId}-prompt`;
const inputMessages = JSON.stringify([
  { role: 'user', parts: [{ type: 'text', content: `${runId} question` }] },
]);
const outputMessages = JSON.stringify([
  { role: 'assistant', parts: [{ type: 'text', content: `${runId} answer` }] },
]);

/** Every dimension the value assertions read, fetched in one query. */
const READ_FIELDS = [
  'traceName',
  'userId',
  'tags',
  'release',
  'promptName',
  'promptVersion',
  'providedModelName',
] as const;

let provider: BasicTracerProvider;
let otelTraceId: string;
/**
 * The rows Langfuse returned for this run, read once.
 *
 * Once, because ingestion finishes once. Three tests each polling for the same
 * trace is three times the requests for no more information, and Cloud's rate
 * limiter charges for every one of them.
 */
/** A JSON value, as Langfuse's HTTP API answers with. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue };

/** One observation or trace row read back from Langfuse; a field may be absent. */
type LangfuseRow = Record<string, JsonValue | undefined>;

let ingested: LangfuseRow[] = [];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A read against Langfuse, waiting out its rate limiter rather than racing it.
 *
 * Cloud caps the entity endpoints at 15 requests a minute and metrics at 100 a
 * day, and answers 429 with the exact number of seconds to wait. Treating that
 * as just another failure is what turns a polling loop into a self-inflicted
 * outage: every retry inside the window makes the next one later.
 */
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', auth);
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });
    if (response.status !== 429 || attempt >= 2) return response;

    // SAFETY: a 429 from Langfuse carries a retry hint in this shape; the catch
    // above supplies {} for a body that is not JSON, and every field is optional.
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as {
      details?: { retryAfterSeconds?: number };
    };
    const retryAfter = body.details?.retryAfterSeconds ?? 60;
    // A wait measured in hours is a quota, not a burst: hand back the 429 and
    // let the caller report it rather than hanging the suite until it clears.
    if (retryAfter > 90) return response;
    await sleep(retryAfter * 1000 + 500);
  }
}

/**
 * Whether this deployment serves the entity read endpoints. Cloud does; v4
 * self-hosted 404s them.
 *
 * Probed at module load rather than in `beforeAll`, because `skipIf` is
 * evaluated when the suite is collected: a flag set later would read as `false`
 * and skip the test on every deployment, including the ones that can run it.
 */
const hasEntityApi = enabled
  ? await api('/api/public/observations?limit=1')
      .then((response) => response.status !== 404)
      .catch(() => false)
  : false;

/**
 * Langfuse requires `config.row_limit` and an `orderBy` on a measure for
 * high-cardinality dimensions such as userId, so every query sends them.
 */
function metricsUrl(fields: readonly string[]): string {
  const query = {
    view: 'observations',
    dimensions: fields.map((field) => ({ field })),
    metrics: [{ measure: 'count', aggregation: 'count' }],
    fromTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
    toTimestamp: new Date(Date.now() + 86_400_000).toISOString(),
    config: { row_limit: 200 },
    orderBy: [{ field: 'count_count', direction: 'desc' }],
  };
  return `/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(query))}`;
}

/**
 * Read rows back, from whichever surface this deployment has.
 *
 * A non-2xx that is not a 404 is thrown, not swallowed. Returning `undefined`
 * for every failure is what turned a Cloud rate-limit into a 90-second timeout
 * reported as "timed out", with the 429 that caused it never printed.
 */
async function rows(fields: readonly string[]): Promise<LangfuseRow[]> {
  if (hasEntityApi) {
    const response = await api(
      `/api/public/observations?limit=100&traceId=${otelTraceId}`,
    );
    if (!response.ok) {
      throw new Error(
        `observations read failed: ${response.status} ${await response.text()}`,
      );
    }
    // SAFETY: the observations endpoint answers with { data }, and the caller
    // defaults it to an empty list below.
    const body = (await response.json()) as {
      data?: LangfuseRow[];
    };
    // The entity API names the model differently from the metrics dimension,
    // and keeps trace-level facts on the trace. Fill both in so one set of
    // assertions covers both deployments.
    const trace = await api(`/api/public/traces/${otelTraceId}`);
    // SAFETY: a trace is a JSON object; the non-ok branch supplies an empty one.
    const traceBody = trace.ok ? ((await trace.json()) as LangfuseRow) : {};
    return (body.data ?? []).map((observation) => ({
      ...observation,
      providedModelName: observation.model,
      // Trace-level facts live on the trace here; the metrics view joins them
      // onto every observation row. Join them by hand so one set of assertions
      // reads the same shape from either surface.
      traceName: traceBody.name,
      userId: traceBody.userId,
      tags: traceBody.tags,
      release: traceBody.release,
      sessionId: traceBody.sessionId,
    }));
  }

  const response = await api(metricsUrl(fields));
  if (!response.ok) {
    throw new Error(
      `metrics read failed: ${response.status} ${await response.text()}`,
    );
  }
  // SAFETY: the metrics endpoint answers with { data }, defaulted below.
  const body = (await response.json()) as { data?: LangfuseRow[] };
  return body.data ?? [];
}

/** Ingestion is asynchronous; give it a bounded chance to catch up. */
async function eventually<T>(
  attempt: () => Promise<T | undefined>,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await attempt();
      if (result !== undefined) return result;
    } catch (error) {
      last = error;
    }
    await sleep(3000);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms${last ? `, last error: ${String(last)}` : ' with no matching row'}`,
  );
}

describe.skipIf(!enabled)('Langfuse contract', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE_URL}/api/public/health`);
    if (!health.ok) {
      throw new Error(
        `Langfuse is not reachable at ${BASE_URL}. Start it with:\n` +
          `  docker compose -f docker/langfuse.yml up -d`,
      );
    }

    provider = new BasicTracerProvider({
      spanProcessors: [
        langfuseCompatibility({
          traceName,
          tags: ['contract'],
          release: 'contract-release',
          version: 'contract-version',
        }),
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `${BASE_URL}/api/public/otel/v1/traces`,
            // The same wire `createLangfuseConfig` produces, ingestion header
            // included, so this suite tests what the preset actually sends.
            headers: {
              Authorization: auth,
              'x-langfuse-ingestion-version': '4',
            },
          }),
        ),
      ],
    });

    // Prompt linking only resolves against a prompt the project actually
    // manages: without this, Cloud returns a null `promptName` and the mapping
    // looks broken when it is the fixture that is missing. Tolerated when the
    // deployment has no prompt API, which is not what this suite is testing.
    const prompt = await api('/api/public/v2/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: promptName,
        prompt: 'contract fixture',
        type: 'text',
        labels: ['production'],
      }),
    });
    if (!prompt.ok && prompt.status !== 404) {
      throw new Error(
        `prompt fixture creation failed: ${prompt.status} ${await prompt.text()}`,
      );
    }

    const tracer = provider.getTracer('contract');
    const root = tracer.startSpan('contract-root');
    otelTraceId = root.spanContext().traceId;
    root.setAttribute('user.id', `${runId}-user`);
    root.setAttribute('session.id', `${runId}-session`);

    // A child, not a second root. Two roots sharing a trace name would be two
    // traces, which is not what any caller of this package produces and would
    // let an assertion pass against the wrong row.
    const generation = tracer.startSpan(
      'contract-generation',
      undefined,
      otelTrace.setSpan(otelContext.active(), root),
    );
    generation.setAttributes({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'contract-model',
      'gen_ai.usage.input_tokens': 11,
      'gen_ai.usage.output_tokens': 7,
      'gen_ai.usage.cost': 0.25,
      'gen_ai.response.time_to_first_chunk': 0.5,
      'gen_ai.prompt.name': promptName,
      // Version 1, because that is the version the fixture above created.
      // Langfuse resolves a prompt by name *and* version, so naming a version
      // that does not exist leaves the link null and looks like a broken
      // mapping.
      'gen_ai.prompt.version': 1,
      // Sent alongside the prompt name on purpose. Langfuse reads the
      // `gen_ai.prompt` prefix as the legacy prompt-content convention and
      // discards these when it finds one, so this pair is only preserved if
      // the processor moved the prompt attributes rather than copying them.
      'gen_ai.input.messages': inputMessages,
      'gen_ai.output.messages': outputMessages,
    });
    generation.end();
    root.end();

    await provider.forceFlush();

    // Wait for the generation to land, then hold the rows every assertion below
    // reads. The prompt name is the marker: it is the last field to be filled
    // in, so a row carrying it carries the rest.
    ingested = await eventually(async () => {
      const found = await rows(READ_FIELDS);
      return found.some((row) => row.promptName === promptName)
        ? found
        : undefined;
    });
  }, 180_000);

  afterAll(async () => {
    await provider?.shutdown();
  });

  it('exposes every field this package maps as a queryable dimension', async () => {
    // The drift alarm. Langfuse rejects an unknown dimension by name, so a
    // renamed or removed field fails here instead of quietly going blank.
    for (const dimension of MAPPED_DIMENSIONS) {
      const response = await api(metricsUrl([dimension]));
      if (response.ok) continue;

      const body = await response.clone().text();
      // A 429 is not the alarm going off. Cloud allows 100 metrics queries a
      // day, and reporting an exhausted quota as "Langfuse rejected
      // traceName" would send someone hunting a rename that never happened.
      // Still a failure — the alarm did not run — just an honest one.
      expect(
        response.status,
        `could not run the drift alarm: Langfuse rate-limited the metrics API. ${body}`,
      ).not.toBe(429);
      expect(
        response.ok,
        `Langfuse rejected the "${dimension}" dimension: ${body}`,
      ).toBe(true);
    }
  }, 120_000);

  it('stores the trace name, tags, release and user that the processor set', () => {
    // Completeness belongs in the predicate. Matching on the name alone
    // returns whichever row the aggregation put first, and a guard applied
    // afterwards would reject it without ever looking at the next one.
    const row = ingested.find(
      (r) => r.traceName === traceName && r.userId && r.release,
    );

    expect(row, `no complete row in ${JSON.stringify(ingested)}`).toBeDefined();
    expect(row!.userId).toBe(`${runId}-user`);
    expect(String(row!.tags)).toContain('contract');
    expect(row!.release).toBe('contract-release');
  });

  it('links the prompt and model from canonical attributes', () => {
    const row = ingested.find(
      (r) =>
        r.promptName === promptName && r.promptVersion && r.providedModelName,
    );

    expect(row, `no linked row in ${JSON.stringify(ingested)}`).toBeDefined();
    expect(String(row!.promptVersion)).toBe('1');
    expect(row!.providedModelName).toBe('contract-model');
  });

  it.skipIf(!enabled || !hasEntityApi)(
    'keeps input and output on a span that also names its prompt',
    () => {
      // The regression that made this suite worth extending. Emitting
      // `gen_ai.prompt.name` alongside `gen_ai.input.messages` used to leave
      // Langfuse showing `{"name": ..., "version": ...}` as the input and `{}`
      // as the output, because it read the legacy convention in preference.
      // Nothing but a real Langfuse can catch that.
      const observation = ingested.find(
        (r) => r.name === 'contract-generation',
      );

      expect(observation).toBeDefined();
      expect(JSON.stringify(observation!.input)).toContain(`${runId} question`);
      expect(JSON.stringify(observation!.output)).toContain(`${runId} answer`);
    },
  );

  it('posts an evaluation result as a score Langfuse returns', async () => {
    const scoreName = `${runId}-faithfulness`;
    const subscriber = langfuseScores({
      baseUrl: BASE_URL,
      publicKey: PUBLIC_KEY,
      secretKey: SECRET_KEY,
      onError: (error) => {
        throw error;
      },
    });

    await subscriber.trackEvent('gen_ai.evaluation.result', {
      traceId: otelTraceId,
      'gen_ai.evaluation.name': scoreName,
      'gen_ai.evaluation.score.value': 0.92,
      'gen_ai.evaluation.explanation': 'grounded in the retrieved passages',
    });

    const score = await eventually(async () => {
      const response = await api('/api/public/v3/scores?limit=100');
      if (!response.ok) return undefined;
      // SAFETY: the scores endpoint answers with { data }; a non-ok response
      // returned above, and the find below tolerates an absent list.
      const body = (await response.json()) as {
        data?: LangfuseRow[];
      };
      return body.data?.find((s) => s.name === scoreName);
    });

    expect(score.value).toBe(0.92);
    expect(score.dataType).toBe('NUMERIC');
    // The comment is stored, but this list endpoint does not return it, so
    // asserting on it here would test Langfuse's serialiser rather than the
    // mapping this package owns.
  }, 120_000);

  it('uploads a base64 payload and returns a reference Langfuse resolves', async () => {
    const media = langfuseMedia({
      baseUrl: BASE_URL,
      publicKey: PUBLIC_KEY,
      secretKey: SECRET_KEY,
    });

    const replaced = await media.replaceDataUris(
      JSON.stringify([
        { role: 'user', parts: [{ type: 'image', content: PNG_DATA_URI }] },
      ]),
      { traceId: otelTraceId, field: 'input' },
    );

    const mediaId = /id=([^|]+)\|/.exec(replaced)?.[1];
    expect(mediaId, `no media token in ${replaced}`).toBeTruthy();

    // Reading it back is the assertion that matters: it proves the bytes
    // survived the presigned PUT and that Langfuse considers the record
    // complete, neither of which the POST response can tell us.
    const stored = await eventually(async () => {
      const response = await api(`/api/public/media/${mediaId}`);
      // SAFETY: the media endpoint answers with a JSON object on 200.
      return response.ok ? ((await response.json()) as LangfuseRow) : undefined;
    });

    expect(stored.contentType).toBe('image/png');
    expect(stored.contentLength).toBe(70);
    expect(stored.url).toBeTruthy();
  }, 120_000);
});

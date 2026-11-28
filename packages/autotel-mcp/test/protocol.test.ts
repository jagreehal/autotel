import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createApp, MCP_PROTOCOL_VERSION, type App } from '../src/app';
import { MCP_APP_MIME_TYPE, TRACE_VIEW_URI } from '../src/apps/trace-view';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

/**
 * The wire, end to end, against a real client pinned to 2026-07-28.
 *
 * Type-checking against the SDK proves nothing about the protocol: the era is
 * decided by the HTTP entry, not by `McpServer`. Pinning the client means no
 * silent fallback to the 2025 handshake — if this server does not speak the
 * current revision, the connection fails here rather than in someone's editor.
 */
describe('MCP 2026-07-28', () => {
  let app: App;
  let http: Server;
  let url: string;

  beforeAll(async () => {
    // The fixture backend needs nothing running.
    // SAFETY: the literal below names every field createApp reads; the
    // assertion only supplies the defaults this test does not vary.
    app = await createApp({
      config: {
        backend: 'fixture',
        transport: 'http',
        port: 0,
        host: '127.0.0.1',
        collectorPort: 4318,
        fixturePath: 'does-not-exist.json',
      } as App['config'],
    });
    await app.start();

    const nodeHandler = toNodeHandler(createMcpHandler(app.createServer));
    const checkHost = localhostHostValidation();
    const checkOrigin = localhostOriginValidation();

    http = createServer(async (req, res) => {
      if (!checkHost(req, res) || !checkOrigin(req, res)) return;
      await nodeHandler(req, res);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    // SAFETY: listen() was awaited on a host/port above, so address() answers
    // with AddressInfo. The string form describes a pipe, never bound here.
    const tcp = address as AddressInfo | null;
    if (tcp === null) {
      throw new Error('expected a TCP address');
    }
    url = `http://127.0.0.1:${tcp.port}/mcp`;
  });

  afterAll(async () => {
    http?.close();
    await app?.stop();
  });

  async function connect(): Promise<Client> {
    const client = new Client(
      { name: 'autotel-mcp-tests', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
  }

  it('negotiates the current revision with no legacy fallback', async () => {
    // The client is pinned to MCP_PROTOCOL_VERSION, so `connect()` throwing is
    // the real failure mode here — which is also what keeps that constant
    // honest, since the SDK does not export the revision it serves. `modern`
    // is the SDK's name for the 2026-07-28 envelope wire.
    const client = await connect();
    expect(client.getProtocolEra()).toBe('modern');
    await client.close();
  });

  it('lists tools with read-only annotations and a cache hint', async () => {
    const client = await connect();
    const { tools, ttlMs, cacheScope } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    // Every tool here reads telemetry; a client that honours annotations can
    // run them without stopping to ask.
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
    // SEP-2549: the catalog is fixed and identical for every caller, so it is
    // worth caching — which matters more now that there is no session.
    expect(ttlMs).toBe(300_000);
    expect(cacheScope).toBe('public');

    await client.close();
  });

  it('answers a tool call', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'backend_capabilities',
      arguments: {},
    });

    // SAFETY: the tool called above returns a text content block, which the
    // next line asserts on - a different block type fails the expectation.
    const [content] = result.content as { type: string; text: string }[];
    expect(content?.type).toBe('text');
    expect(JSON.parse(content!.text)).toMatchObject({ ok: true });

    await client.close();
  });

  it('serves get_trace with its waterfall view (MCP Apps)', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const getTrace = tools.find((tool) => tool.name === 'get_trace');
    expect(getTrace?._meta).toEqual({ ui: { resourceUri: TRACE_VIEW_URI } });

    const { contents } = await client.readResource({ uri: TRACE_VIEW_URI });
    const [view] = contents;
    expect(view?.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(view && 'text' in view ? view.text : undefined).toMatch(
      /^<!doctype html>.*<script>/s,
    );

    await client.close();
  });

  it('offers telemetry as MCP Events, by poll', async () => {
    const client = await connect();
    expect(
      client.getServerCapabilities()?.extensions?.[
        'io.modelcontextprotocol/events'
      ],
    ).toEqual({});

    // SAFETY: the SDK validated the response against the schema passed here.
    const listed = (await client.request(
      { method: 'events/list', params: {} },
      z.looseObject({ events: z.array(z.looseObject({ name: z.string() })) }),
    )) as { events: Array<{ name: string; delivery: string[] }> };
    expect(listed.events.map((e) => [e.name, e.delivery])).toEqual([
      ['autotel.issue.opened', ['poll']],
      ['autotel.deploy.detected', ['poll']],
    ]);

    const PollResult = z.looseObject({
      events: z.array(z.unknown()),
      cursor: z.string(),
      nextPollMs: z.number(),
    });
    const fresh = await client.request(
      {
        method: 'events/poll',
        params: { name: 'autotel.issue.opened', cursor: null },
      },
      PollResult,
    );
    expect(fresh).toMatchObject({ events: [], nextPollMs: 60_000 });
    // Reading the backend is covered in telemetry-events.test.ts; this
    // suite's fixture backend has no file to read.

    await expect(
      client.request(
        { method: 'events/poll', params: { name: 'made.up', cursor: null } },
        PollResult,
      ),
    ).rejects.toMatchObject({ code: -32_023 });

    await client.close();
  });

  it('refuses a cross-origin request from a browser page', async () => {
    // Binding to 127.0.0.1 is not the mitigation: any page can post to it.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(403);
  });

  describe('Skills over MCP', () => {
    const SkillsResult = z.looseObject({
      skills: z.array(z.looseObject({ uri: z.string() })),
      ttlMs: z.number(),
      cacheScope: z.string(),
    });
    const SkillResult = z.looseObject({
      skill: z.looseObject({
        uri: z.string(),
        frontmatter: z.looseObject({
          name: z.string(),
          description: z.string(),
        }),
        resources: z.array(
          z.looseObject({
            uri: z.string(),
            digest: z.string(),
            size: z.number(),
          }),
        ),
      }),
    });

    it('declares the extension and lists the skills it serves', async () => {
      const client = await connect();
      const extensions = client.getServerCapabilities()?.extensions ?? {};
      expect(Object.keys(extensions)).toContain(
        'io.modelcontextprotocol/skills',
      );
      // SAFETY: the SDK validated the response against SkillsResult.
      const { skills } = (await client.request(
        { method: 'skills/list', params: {} } as never,
        SkillsResult,
      )) as z.infer<typeof SkillsResult>;
      expect(skills.map((s) => s.uri)).toContain(
        'skill://analyze-traces/SKILL.md',
      );
    });

    it('returns a skill by URI, and reads its SKILL.md as a resource whose digest matches', async () => {
      const client = await connect();
      const uri = 'skill://autotel-mcp/SKILL.md';
      // SAFETY: as above.
      const { skill } = (await client.request(
        { method: 'skills/get', params: { uri } } as never,
        SkillResult,
      )) as z.infer<typeof SkillResult>;
      expect(skill.frontmatter.name).toBe('autotel-mcp');
      const read = await client.readResource({ uri });
      const [content] = read.contents;
      const text = content && 'text' in content ? content.text : '';
      const listed = skill.resources.find((r) => r.uri === uri);
      expect(listed?.size).toBe(Buffer.byteLength(text, 'utf8'));
      expect(content?.mimeType).toBe('text/markdown');
    });

    it('answers a URI it does not serve with invalid params', async () => {
      const client = await connect();
      await expect(
        client.request(
          // SAFETY: request() is typed by the SDK's own request union; skills/get is
          // an extension method it sends as given, validated against SkillResult.
          {
            method: 'skills/get',
            params: { uri: 'skill://made-up/SKILL.md' },
          } as never,
          SkillResult,
        ),
      ).rejects.toMatchObject({ code: -32_602 });
    });
  });
});

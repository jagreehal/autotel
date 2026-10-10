/**
 * The `get_trace` view (MCP Apps): the autotel-devtools waterfall, served as a
 * `ui://` resource. A host that renders MCP Apps (Claude, ChatGPT, VS Code)
 * draws the trace inline in the chat; any other host reads the JSON as before.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';

export const TRACE_VIEW_URI = 'ui://autotel/trace-view.html';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

declare const __filename: string | undefined;
const moduleFile =
  /* oxlint-disable-next-line anti-slop/no-runtime-typeof -- Probing which module format this build is running as, as version.ts does. */
  typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);
const require = createRequire(moduleFile);

/**
 * Where the view's script lives: next to the built server in `dist/`, where
 * the build copies it, and in the devtools workspace package when running
 * from source (tests, `pnpm dev`).
 */
function viewScriptPaths(): string[] {
  const paths = [
    path.join(path.dirname(moduleFile), 'mcp-app-trace.global.js'),
  ];
  try {
    paths.push(require.resolve('autotel-devtools/mcp-app/trace'));
  } catch {
    // Not installed: a published autotel-mcp reads its own copy.
  }
  return paths;
}

let cached: string | null | undefined;

/**
 * The view as one HTML document, or `null` when the bundle is missing (an
 * unbuilt checkout). The script is inlined: a view's sandbox loads nothing
 * from the network unless its resource declares the origin.
 */
export function traceViewHtml(): string | null {
  if (cached !== undefined) return cached;
  for (const file of viewScriptPaths()) {
    let script: string;
    try {
      script = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // `</script` inside the bundle would end the inline script early.
    const inline = script.replaceAll('</script', String.raw`<\/script`);
    cached = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Trace</title></head><body><script>${inline}</script></body></html>`;
    return cached;
  }
  cached = null;
  return cached;
}

/** `_meta` for a tool whose result the view draws; empty without the bundle. */
export function traceViewToolMeta(): Record<string, unknown> {
  return traceViewHtml() === null
    ? {}
    : { _meta: { ui: { resourceUri: TRACE_VIEW_URI } } };
}

export function registerTraceView(server: McpServer): void {
  const html = traceViewHtml();
  if (html === null) return;
  server.registerResource(
    'trace-view',
    TRACE_VIEW_URI,
    {
      title: 'Trace waterfall',
      description: 'Interactive waterfall for get_trace results.',
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: TRACE_VIEW_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: html,
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );
}

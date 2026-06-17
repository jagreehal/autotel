/**
 * Minimal OTLP/JSON sink for local evidence capture.
 *
 * Receives traces autotel exports over OTLP (e.g. from `wrangler dev` with
 * NATIVE_TRACING=off) and writes a flattened span list to scripts/otlp-spans.json.
 *
 * Run: `node scripts/otlp-sink.mjs`  (listens on :4318)
 */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const spans = [];
const OUT = new URL('./otlp-spans.json', import.meta.url);

function flatten(body) {
  for (const rs of body.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const attrs = {};
        for (const a of s.attributes ?? []) {
          const v = a.value ?? {};
          attrs[a.key] =
            v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? '';
        }
        spans.push({
          name: s.name,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId || null,
          kind: s.kind,
          status: s.status?.code ?? 0,
          attributes: attrs,
        });
      }
    }
  }
  writeFileSync(OUT, JSON.stringify(spans, null, 2));
}

createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/v1/traces')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        flatten(JSON.parse(raw));
        process.stdout.write(`captured → ${spans.length} spans total\n`);
      } catch (e) {
        process.stdout.write(`parse error: ${e}\n`);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(4318, () => process.stdout.write('OTLP sink on :4318\n'));

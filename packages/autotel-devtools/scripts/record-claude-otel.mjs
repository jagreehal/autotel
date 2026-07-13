// Record a real Claude Code OTLP export and sanitize it into a golden test
// fixture. Two modes:
//
//   node scripts/record-claude-otel.mjs                 # capture: launch a
//       capture receiver, run `claude -p <prompt>` wired to it, then sanitize.
//   node scripts/record-claude-otel.mjs --from-dir DIR  # sanitize an existing
//       raw capture (DIR/{logs,metrics}.jsonl) without launching Claude.
//
// The output pins the *real wire format* of the version of Claude Code that
// produced it, so `claude-code-contract.test.ts` fails loudly on drift. It is
// NOT run in CI — re-run it by hand to refresh the fixture after a Claude Code
// upgrade, then eyeball the diff.
//
// SANITISATION (mandatory — the raw capture contains PII + full conversation):
//   - identity attrs (email, account/org uuids) → redacted
//   - session.id → a fixed fake, so the fixture is deterministic
//   - volatile ids (request_id, response.id, prompt.id) → redacted
//   - content (prompt / response / raw api bodies / tool i/o text) → dropped,
//     keeping only the *shape* (event.name, lengths, sizes, model, tokens…).
// Event names are preserved verbatim so the drift guard can see every signal.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../src/server/__tests__/__fixtures__');

const FIXED_SESSION = 'fixture-session-0001';
// Attribute keys whose *value* is replaced with a constant redaction.
const REDACT_KEYS = new Set([
  'user.email', 'user.id', 'user.account_uuid', 'user.account_id',
  'organization.id', 'request_id', 'client_request_id',
  'gen_ai.response.id', 'prompt.id', 'plugin_id_hash',
]);
// Attribute keys whose value is free-text content — dropped entirely.
const DROP_KEYS = new Set([
  'prompt', 'response', 'body', 'tool_input', 'tool_parameters',
  'tool_result', 'full_command', 'user_prompt',
]);

function sanitizeAttr(attr) {
  const key = attr.key;
  if (DROP_KEYS.has(key)) return null;
  if (key === 'session.id') {
    return { key, value: { stringValue: FIXED_SESSION } };
  }
  if (REDACT_KEYS.has(key)) return { key, value: { stringValue: 'REDACTED' } };
  return attr;
}

function sanitizeAttrs(attrs) {
  if (!Array.isArray(attrs)) return attrs;
  return attrs.map(sanitizeAttr).filter(Boolean);
}

function sanitizeLogs(batches) {
  const resourceLogs = [];
  for (const batch of batches) {
    for (const rl of batch.resourceLogs ?? []) {
      if (rl.resource) rl.resource.attributes = sanitizeAttrs(rl.resource.attributes);
      for (const sl of rl.scopeLogs ?? []) {
        for (const lr of sl.logRecords ?? []) {
          lr.attributes = sanitizeAttrs(lr.attributes);
        }
      }
      resourceLogs.push(rl);
    }
  }
  return { resourceLogs };
}

function sanitizeMetrics(batches) {
  const resourceMetrics = [];
  for (const batch of batches) {
    for (const rm of batch.resourceMetrics ?? []) {
      if (rm.resource) rm.resource.attributes = sanitizeAttrs(rm.resource.attributes);
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          const dps = (m.sum ?? m.gauge ?? m.histogram ?? {}).dataPoints ?? [];
          for (const dp of dps) dp.attributes = sanitizeAttrs(dp.attributes);
        }
      }
      resourceMetrics.push(rm);
    }
  }
  return { resourceMetrics };
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function writeFixtures(rawDir) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logs = sanitizeLogs(readJsonl(path.join(rawDir, 'logs.jsonl')));
  const metrics = sanitizeMetrics(readJsonl(path.join(rawDir, 'metrics.jsonl')));
  fs.writeFileSync(
    path.join(OUT_DIR, 'claude-code-logs.otlp.json'),
    JSON.stringify(logs, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'claude-code-metrics.otlp.json'),
    JSON.stringify(metrics, null, 2) + '\n',
  );
  const logCount = logs.resourceLogs.reduce(
    (n, rl) => n + (rl.scopeLogs ?? []).reduce((m, sl) => m + (sl.logRecords ?? []).length, 0),
    0,
  );
  const metricCount = metrics.resourceMetrics.reduce(
    (n, rm) => n + (rm.scopeMetrics ?? []).reduce((m, sm) => m + (sm.metrics ?? []).length, 0),
    0,
  );
  process.stdout.write(
    `wrote fixtures → ${OUT_DIR}\n  ${logCount} log records, ${metricCount} metrics\n`,
  );
}

// ── capture mode: run claude wired to a local receiver ──────────────────────
async function capture(prompt) {
  const rawDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'claudeotel-'));
  const files = {
    '/v1/traces': path.join(rawDir, 'traces.jsonl'),
    '/v1/logs': path.join(rawDir, 'logs.jsonl'),
    '/v1/metrics': path.join(rawDir, 'metrics.jsonl'),
  };
  const server = http.createServer((req, res) => {
    const f = files[req.url];
    if (req.method !== 'POST' || !f) return res.writeHead(404).end();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        fs.appendFileSync(f, JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())) + '\n');
      } catch {
        /* protobuf / non-json — ignore; we ask for json below */
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise((r) => server.listen(4318, '127.0.0.1', r));

  const env = {
    ...process.env,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    OTEL_METRIC_EXPORT_INTERVAL: '2000',
    OTEL_LOGS_EXPORT_INTERVAL: '1000',
    OTEL_LOG_TOOL_DETAILS: '1',
  };
  await new Promise((resolve) => {
    const child = spawn('claude', ['-p', prompt, '--allowedTools', 'Bash Read Glob'], {
      stdio: 'inherit',
      env,
    });
    child.on('exit', resolve);
  });
  await new Promise((r) => setTimeout(r, 3000)); // final flush
  await new Promise((r) => server.close(r));
  writeFixtures(rawDir);
}

const arg = process.argv[2];
if (arg === '--from-dir') {
  writeFixtures(process.argv[3]);
} else {
  const prompt =
    arg ?? "Use the Bash tool to run 'ls -a', then write a one-sentence summary of what you see.";
  await capture(prompt);
}

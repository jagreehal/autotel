#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { renderTerminal } from './index';
import { getTerminalLogStream } from './log-stream';
import { CliTerminalSpanStream } from './cli-stream';
import {
  countOtlpMetrics,
  parseOtlpEvents,
  parseOtlpLogEvents,
  readJsonBody,
  sendJson,
} from './otlp-http-json';

import type { AIConfig, AIProviderType } from './ai/types';

type CliOptions = {
  port: number;
  host: string;
  title?: string;
  ai: Partial<AIConfig>;
};

function printHelp(): void {
  process.stdout.write(
    String.raw`autotel-terminal - Standalone OTLP receiver with terminal dashboard

Usage: autotel-terminal [options]

Options:
  -p, --port <port>          Port to listen on (default: 4319, env: AUTOTEL_TERMINAL_PORT)
  -H, --host <host>          Host to bind to (default: 127.0.0.1, env: AUTOTEL_TERMINAL_HOST)
  -t, --title <title>        Dashboard title (env: AUTOTEL_TERMINAL_TITLE)
  -h, --help                 Show this help message
  -v, --version              Show version number

AI Options:
  --ai-provider <provider>   AI provider: ollama, openai, openai-compatible (env: AI_PROVIDER)
  --ai-model <model>         AI model name (env: AI_MODEL)
  --ai-api-key <key>         API key for cloud providers (env: AI_API_KEY)
  --ai-base-url <url>        Custom AI endpoint URL (env: AI_BASE_URL)

  Auto-detection: if Ollama is running locally, it is used automatically.
  If OPENAI_API_KEY is set, OpenAI is used. Press 'a' in the dashboard to toggle AI.

Endpoints:
  POST /v1/traces            Receive OTLP JSON trace data
  POST /v1/logs              Receive OTLP JSON log data
  POST /v1/metrics           Receive OTLP JSON metric data (accepted and counted)
  GET  /healthz              Health check

Examples:
  npx autotel-terminal
  npx autotel-terminal --ai-provider ollama --ai-model granite4
  AI_API_KEY=sk-... npx autotel-terminal --ai-provider openai --ai-model gpt-4o
` + '\n',
  );
}

function printVersion(): void {
  try {
    const dir = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
    const pkgPath = path.resolve(dir, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
  } catch {
    process.stdout.write('unknown\n');
  }
}

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = {
    port: Number(process.env.AUTOTEL_TERMINAL_PORT || 4319),
    host: process.env.AUTOTEL_TERMINAL_HOST || '127.0.0.1',
    title: process.env.AUTOTEL_TERMINAL_TITLE,
    ai: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      return null;
    }
    if (arg === '--version' || arg === '-v') {
      printVersion();
      return null;
    }
    if ((arg === '--port' || arg === '-p') && next) {
      options.port = Number(next);
      i++;
      continue;
    }
    if ((arg === '--host' || arg === '-H') && next) {
      options.host = next;
      i++;
      continue;
    }
    if ((arg === '--title' || arg === '-t') && next) {
      options.title = next;
      i++;
      continue;
    }
    if (arg === '--ai-provider' && next) {
      options.ai.provider = next as AIProviderType;
      i++;
      continue;
    }
    if (arg === '--ai-model' && next) {
      options.ai.model = next;
      i++;
      continue;
    }
    if (arg === '--ai-api-key' && next) {
      options.ai.apiKey = next;
      i++;
      continue;
    }
    if (arg === '--ai-base-url' && next) {
      options.ai.baseUrl = next;
      i++;
    }
  }

  return options;
}

const OTLP_ROUTES = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    process.exit(0);
  }

  const spanStream = new CliTerminalSpanStream();
  const logStream = getTerminalLogStream();

  renderTerminal(
    {
      title:
        options.title || `Autotel Terminal (${options.host}:${options.port})`,
      ai: options.ai,
    },
    spanStream,
  );

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST' || !OTLP_ROUTES.has(req.url ?? '')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const payload = await readJsonBody(req);

      if (req.url === '/v1/traces') {
        const events = parseOtlpEvents(payload);
        for (const event of events) {
          spanStream.push(event);
        }
        sendJson(res, 200, { acceptedSpans: events.length });
        return;
      }

      if (req.url === '/v1/logs') {
        const events = parseOtlpLogEvents(payload);
        for (const event of events) {
          logStream.emit(event);
        }
        sendJson(res, 200, { acceptedLogs: events.length });
        return;
      }

      if (req.url === '/v1/metrics') {
        const count = countOtlpMetrics(payload);
        sendJson(res, 200, { acceptedMetrics: count });
        return;
      }
    } catch (error) {
      sendJson(res, 400, {
        error: 'Invalid OTLP JSON payload',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(options.port, options.host, () => {
    process.stdout.write(
      `[autotel-terminal] listening on http://${options.host}:${options.port}\n`,
    );
    process.stdout.write(
      '[autotel-terminal] endpoints: /v1/traces, /v1/logs, /v1/metrics\n',
    );
    process.stdout.write(
      '[autotel-terminal] set OTEL_EXPORTER_OTLP_PROTOCOL=http/json and OTEL_EXPORTER_OTLP_ENDPOINT to this host/port\n',
    );
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  process.stderr.write(
    `[autotel-terminal] failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});

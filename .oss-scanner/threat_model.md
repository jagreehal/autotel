# Threat model

## What this project does

autotel is an OpenTelemetry toolkit for Node, edge runtimes and browsers. `init()` sets up tracing, metrics and logs; `trace()` wraps functions; subscribers forward product events to analytics tools and webhooks. Around the core sit framework and database integrations, an OTLP receiver with a web UI (`autotel-devtools`), a VS Code extension, a terminal dashboard, an MCP server that lets agents query telemetry (`autotel-mcp`), and a CLI.

## Trust boundaries and where untrusted input enters

The developer who configures autotel and the code it instruments are trusted. Configuration files, environment variables and `init()` options are not attacker input.

Untrusted input:

1. **Data that ends up in telemetry.** Span names, attributes, events, log bodies, baggage and exception messages often carry request data: URLs, headers, query strings, SQL, LLM prompts and completions. Treat every string as attacker-controlled.
   - Redaction (`packages/autotel/src/attribute-redacting-processor.ts`, attribute validators, PII handling in integrations) must not let configured secrets or PII through, for example through case, encoding or nesting tricks.
   - Instrumentation must not record credentials it was not asked to (Authorization headers, cookies, connection-string passwords, API keys).
2. **Incoming trace context.** `traceparent`, `tracestate` and `baggage` headers from clients are attacker-controlled. Parsing must be bounded, and baggage must not be able to set attributes that change sampling, audit behaviour or "force-keep" decisions in ways the application did not allow.
3. **OTLP receivers.** `autotel-devtools`, `autotel-vscode` and `autotel-terminal` accept OTLP over HTTP. Any process or web page that can reach the port can send data.
   - The devtools server binds loopback by default. Check that a browser page on another origin cannot post to it or read from it (CORS, DNS rebinding, Host header checks).
   - Its web UI, the VS Code webview and the MCP app view render span data and must escape it: stored XSS from a span attribute is in scope. The VS Code "jump to source" feature must not open or execute arbitrary paths.
4. **MCP server** (`autotel-mcp`). It answers agent tool calls by querying telemetry backends. Tool arguments must not lead to path traversal, SSRF to hosts other than configured backends, or query injection into backend query languages.
5. **Outbound subscribers** (`autotel-subscribers`, `autotel-posthog`, `autotel-sentry`, `autotel-langfuse`, …). Event data flows to third-party APIs and webhooks. Event content must not be able to change the destination URL, inject headers, or leak the subscriber's credentials.
6. **Browser and edge SDKs** (`autotel-web`, `autotel-edge`, `autotel-cloudflare`). Headers they propagate must not leak to third-party origins beyond what the developer configured.

## Components that matter most / least

- Most: `packages/autotel` (core, redaction, context propagation), `autotel-devtools`, `autotel-vscode`, `autotel-mcp`, `autotel-subscribers`, `autotel-web`, `autotel-edge`, `autotel-cloudflare`, and the HTTP, database and GenAI integrations that capture request data.
- Less: `autotel-cli` (runs locally on developer input), `autotel-terminal`, test helpers (`autotel-vitest`, `autotel-playwright`, `autotel-pact`).
- Out of scope: `apps/*` (examples, book chapters, docs app), `examples/*`, `docs`, `docker/`, `tools/`, tests, and bugs in OpenTelemetry or other dependencies unless autotel uses them unsafely.

## How to exercise it

- Build: `pnpm turbo run build --filter='./packages/*'` (already done in the image).
- Unit tests: `pnpm --filter <package> test`. They run offline.
- Devtools: `node packages/autotel-devtools/dist/cli.js`, then POST OTLP JSON to it and open the UI in the Playwright Chromium installed in the image.
- Integration tests (`test:integration`) need MongoDB or real backends and will not run offline.

## How we rate severity

- Critical: remote code execution; a remote attacker (another origin or another host) reading or injecting data in a devtools/VS Code receiver bound to loopback; credentials sent to an attacker-chosen host.
- High: secrets or PII exported despite redaction configured to remove them; stored XSS in the devtools UI, VS Code webview or MCP app from span data; path traversal or SSRF through `autotel-mcp` tool arguments; incoming baggage changing sampling or audit decisions the application did not allow.
- Medium: instrumentation recording credentials by default that a developer would not expect; denial of service from a single request's trace headers or a single OTLP payload; header or URL injection in outbound subscribers.
- Low: unbounded memory from very large but legitimate payloads; information disclosure of local paths.
- Not a finding: anything that needs control of autotel's configuration, the instrumented application's code, or the machine running it.

## Reports and patches

Give a minimal reproducer as a unit test beside the existing tests in the affected package, or an OTLP payload plus the command that sends it. Keep patches minimal and include that test. Report a root cause once, not once per integration that reaches it.

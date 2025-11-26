/**
 * Debug Proxy for Datadog OTLP Requests
 *
 * This proxy intercepts OTLP requests to Datadog, logs the full details,
 * and forwards them to the actual Datadog endpoint.
 *
 * Usage:
 * 1. Start this proxy: pnpm start:debug-proxy
 * 2. Update .env: DATADOG_ENDPOINT=http://localhost:8080
 * 3. Run your app: pnpm start
 * 4. Check proxy logs to see what's being sent/received
 */

import 'dotenv/config';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PROXY_PORT = 8080;
const DATADOG_SITE = process.env.DATADOG_SITE || 'datadoghq.eu';
const DATADOG_ENDPOINT = `https://otlp.${DATADOG_SITE}`;

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
} as const;

function formatHeaders(headers: http.IncomingHttpHeaders): string {
  return Object.entries(headers)
    .map(([key, value]) => `    ${key}: ${value}`)
    .join('\n');
}

function formatBody(body: Buffer, contentType?: string): string {
  try {
    if (contentType?.includes('json')) {
      const json = JSON.parse(body.toString());
      return JSON.stringify(json, null, 2);
    }
    // For protobuf, just show size and first few bytes
    if (contentType?.includes('protobuf')) {
      const preview = body.slice(0, 50).toString('hex');
      return `[Protobuf ${body.length} bytes] ${preview}...`;
    }
    return body.toString('utf-8').slice(0, 500);
  } catch {
    return `[Binary ${body.length} bytes]`;
  }
}

const server = http.createServer((req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${colors.bright}${colors.cyan}[${timestamp}] Request ${requestId}${colors.reset}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`${colors.green}→ Incoming Request:${colors.reset}`);
  console.log(`  Method: ${colors.bright}${req.method}${colors.reset}`);
  console.log(`  Path: ${colors.bright}${req.url}${colors.reset}`);
  console.log(`  Headers:`);
  console.log(formatHeaders(req.headers));

  // Collect request body
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const requestBody = Buffer.concat(chunks);

    console.log(`\n${colors.yellow}→ Request Body:${colors.reset}`);
    console.log(formatBody(requestBody, req.headers['content-type']));

    // Forward to Datadog
    const targetUrl = new URL(req.url || '/', DATADOG_ENDPOINT);
    console.log(`\n${colors.blue}→ Forwarding to Datadog:${colors.reset}`);
    console.log(`  URL: ${targetUrl.href}`);

    const proxyReq = https.request(
      {
        method: req.method,
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + targetUrl.search,
        headers: {
          ...req.headers,
          host: targetUrl.hostname, // Override host header
        },
      },
      (proxyRes) => {
        console.log(`\n${colors.green}← Datadog Response:${colors.reset}`);
        console.log(`  Status: ${colors.bright}${proxyRes.statusCode} ${proxyRes.statusMessage}${colors.reset}`);
        console.log(`  Headers:`);
        console.log(formatHeaders(proxyRes.headers));

        // Collect response body
        const responseChunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
        proxyRes.on('end', () => {
          const responseBody = Buffer.concat(responseChunks);

          console.log(`\n${colors.yellow}← Response Body:${colors.reset}`);
          console.log(formatBody(responseBody, proxyRes.headers['content-type']));

          // Check for errors
          if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
            console.log(`\n${colors.bright}${colors.red}⚠️  ERROR RESPONSE FROM DATADOG${colors.reset}`);
            console.log(`Status: ${proxyRes.statusCode}`);
            console.log(`Body: ${responseBody.toString()}`);
          } else {
            console.log(`\n${colors.green}✅ Request forwarded successfully${colors.reset}`);
          }

          console.log(`${'='.repeat(80)}\n`);

          // Send response back to client
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          res.end(responseBody);
        });
      },
    );

    proxyReq.on('error', (error) => {
      console.error(`\n${colors.red}❌ Proxy Error:${colors.reset}`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });

    // Forward request body
    proxyReq.write(requestBody);
    proxyReq.end();
  });

  req.on('error', (error) => {
    console.error(`\n${colors.red}❌ Request Error:${colors.reset}`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${colors.bright}${colors.green}🔍 Datadog OTLP Debug Proxy${colors.reset}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`${colors.cyan}Proxy listening on:${colors.reset}     http://localhost:${PROXY_PORT}`);
  console.log(`${colors.cyan}Forwarding to:${colors.reset}         ${DATADOG_ENDPOINT}`);
  console.log(`${colors.cyan}Datadog Site:${colors.reset}          ${DATADOG_SITE}`);
  console.log(`\n${colors.yellow}📝 Instructions:${colors.reset}`);
  console.log(`1. Keep this proxy running`);
  console.log(`2. In another terminal, temporarily modify the example to use:`);
  console.log(`   ${colors.bright}endpoint: 'http://localhost:${PROXY_PORT}'${colors.reset}`);
  console.log(`3. Run: pnpm start`);
  console.log(`4. Watch this terminal for detailed request/response logs`);
  console.log(`${'='.repeat(80)}\n`);
  console.log(`${colors.green}Ready to intercept requests...${colors.reset}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${colors.yellow}Shutting down proxy...${colors.reset}`);
  server.close(() => {
    console.log(`${colors.green}Proxy stopped${colors.reset}`);
    process.exit(0);
  });
});

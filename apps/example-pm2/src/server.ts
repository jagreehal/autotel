import http from 'node:http';
import { init, shutdown, span, trace } from 'autotel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import io from 'pm2-io-otel';
import { Pm2SpanExporter } from './pm2-span-exporter';

const endpoint = process.env.OTLP_ENDPOINT ?? 'http://localhost:4318';

// autotel owns tracing. spanExporters replaces the default OTLP pipeline, so
// OTLP is listed beside PM2.
init({
  service: 'example-pm2',
  spanExporters: [
    new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    new Pm2SpanExporter(),
  ],
});

// `{ enabled: false }` is the form that turns its tracing off, leaving the
// global tracer provider to autotel.
io.init({ tracing: { enabled: false } });

const orders = io.counter({ name: 'orders' });
io.action('orders:count', (reply: (data: unknown) => void) => {
  reply({ orders: orders.val() });
});

const checkout = trace('checkout', async () => {
  await span({ name: 'charge' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  orders.inc();
});

const declined = trace('declined', async () => {
  throw new Error('card declined');
});

const server = http.createServer(async (request, response) => {
  try {
    await (request.url === '/fail' ? declined() : checkout());
    response.end('ok\n');
  } catch {
    response.statusCode = 500;
    response.end('failed\n');
  }
});
server.listen(Number(process.env.PORT ?? 3000));

process.once('SIGINT', async () => {
  server.close();
  await shutdown();
  process.exit(0);
});

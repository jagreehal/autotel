import {
  init,
  getMeter,
  createCounter,
  createHistogram,
  flush,
  shutdown,
} from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 9: Metrics ===\n');

  init({
    service: 'book-09',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Create a counter
  const requestCounter = createCounter('http.requests', {
    description: 'Total HTTP requests',
  });
  requestCounter.add(1, { method: 'GET', path: '/api/users' });
  requestCounter.add(1, { method: 'POST', path: '/api/orders' });
  requestCounter.add(1, { method: 'GET', path: '/api/users' });
  console.log('  ✓ Counter "http.requests": 3 requests recorded');

  // Create a histogram
  const latencyHistogram = createHistogram('http.request.duration', {
    description: 'Request duration in ms',
    unit: 'ms',
  });
  latencyHistogram.record(42, { method: 'GET' });
  latencyHistogram.record(156, { method: 'POST' });
  latencyHistogram.record(28, { method: 'GET' });
  console.log('  ✓ Histogram "http.request.duration": 3 records');

  // getMeter() exposes the underlying OTel Meter for instrument types
  // that have no helper, e.g. an UpDownCounter for gauge-like values
  const meter = getMeter();
  const queueDepth = meter.createUpDownCounter('queue.depth', {
    description: 'Jobs currently in the queue',
  });
  queueDepth.add(5);
  queueDepth.add(-2);
  console.log('  ✓ UpDownCounter "queue.depth": now at 3');

  await flush();
  await shutdown();
  console.log('\n✓ Metrics API demonstrated (counters, histograms, meters)');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

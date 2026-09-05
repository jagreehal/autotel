import { init, trace, flush, shutdown } from 'autotel';
import { getConfig } from 'autotel/config';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

// Standard OTel environment variables init() understands:
//   OTEL_SERVICE_NAME              service name
//   OTEL_EXPORTER_OTLP_ENDPOINT    collector URL
//   OTEL_EXPORTER_OTLP_PROTOCOL    http | grpc
//   OTEL_EXPORTER_OTLP_HEADERS     auth headers
//   OTEL_RESOURCE_ATTRIBUTES       extra resource metadata (k=v,k=v)
//   OTEL_TRACES_SAMPLER(_ARG)      sampling strategy
// Precedence: init() args > autotel.yaml > env vars > defaults.

// Env vars must be set BEFORE init(); it reads them once.
process.env.OTEL_SERVICE_NAME = 'service-name-from-env';
process.env.OTEL_RESOURCE_ATTRIBUTES =
  'team.name=platform,deployment.region=eu-west-1';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 7: Configuration ===\n');

  init({
    service: 'book-07', // init args beat OTEL_SERVICE_NAME
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const ping = trace('config.ping', () => 'pong');
  console.log('  config.ping →', ping());

  await flush();

  const [span] = exporter.getFinishedSpans();
  if (!span) throw new Error('Expected one exported span');
  const resource = span.resource.attributes;

  // init() args win over OTEL_SERVICE_NAME
  if (resource['service.name'] !== 'book-07') {
    throw new Error(
      `Expected service.name "book-07" (init arg), got "${String(resource['service.name'])}"`,
    );
  }
  console.log('  ✓ service.name = book-07 (init arg beat OTEL_SERVICE_NAME)');

  // OTEL_RESOURCE_ATTRIBUTES still merge into the resource
  if (resource['team.name'] !== 'platform') {
    throw new Error(
      `Expected team.name "platform" from OTEL_RESOURCE_ATTRIBUTES, got "${String(resource['team.name'])}"`,
    );
  }
  console.log('  ✓ team.name = platform (from OTEL_RESOURCE_ATTRIBUTES)');

  // getConfig() exposes the runtime tracer/meter configuration
  const runtime = getConfig();
  if (!runtime.tracerName) {
    throw new Error('getConfig().tracerName should be set');
  }
  if (runtime.featureFlags.ENABLE_TRACING !== true) {
    throw new Error('Tracing should be enabled by default');
  }
  console.log(
    `  ✓ getConfig() → tracerName="${runtime.tracerName}", tracing enabled`,
  );

  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

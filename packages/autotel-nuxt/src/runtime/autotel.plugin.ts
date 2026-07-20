import { init } from 'autotel';

export default function autotelNuxtPlugin(): void {
  init({
    service: process.env.OTEL_SERVICE_NAME ?? 'nuxt-app',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
}

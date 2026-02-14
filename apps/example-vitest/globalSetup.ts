import { init } from 'autotel';

export default function globalSetup() {
  init({
    service: 'vitest-e2e-example',
    debug: true,
    endpoint: process.env.OTLP_ENDPOINT,
  });
}

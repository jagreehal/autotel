import { init } from 'autotel';

export default function globalSetup() {
  init({
    service: 'playwright-e2e-example',
    debug: true,
    endpoint: process.env.OTLP_ENDPOINT,
  });
}

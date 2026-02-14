import { init } from 'autotel';

export default function globalSetup() {
  init({
    service: 'autotel-vitest-compat',
    endpoint: process.env.OTLP_ENDPOINT,
  });
}

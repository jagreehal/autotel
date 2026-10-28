// Loaded with `tsx --import` before the app, so Express and http are patched
// as they are first imported.
import 'autotel/register';
import 'dotenv/config';
import { init } from 'autotel';
import {
  createDatadogConfig,
  type DatadogSite,
} from 'autotel-backends/datadog';

const apiKey = process.env.DATADOG_API_KEY;
if (!apiKey) {
  console.error('Set DATADOG_API_KEY in .env (see .env.example).');
  process.exit(1);
}

// SAFETY: a wrong site fails loudly at the first export; the preset documents
// the valid ones.
const site = (process.env.DATADOG_SITE ?? 'datadoghq.com') as DatadogSite;

export const datadog = {
  apiKey,
  site,
  version: process.env.VITE_APP_VERSION ?? '1.0.0',
  environment: process.env.VITE_APP_ENV ?? 'local',
};

init({
  ...createDatadogConfig({
    ...datadog,
    service: 'example-datadog-react-express-api',
  }),
  autoInstrumentations: ['http', 'express'],
  // The browser's `session.id` baggage lands on server spans under that name.
  baggage: '',
});

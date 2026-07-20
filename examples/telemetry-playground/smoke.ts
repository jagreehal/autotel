import { createTelemetry, telemetry } from 'autotel-telemetry';

const handle = createTelemetry({ name: 'playground', version: '0.0.0' });
telemetry.set({ smoke: 1 });
await handle.finish('success');
await handle.flush();
console.log('telemetry smoke ok');

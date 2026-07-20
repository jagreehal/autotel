# autotel-nuxt

Nuxt module that exposes Autotel Nitro adapters for server routes and middleware.

## Setup

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['autotel-nuxt'],
});
```

```ts
// server/api/health.get.ts
import { withAutotelEventHandler, useLogger } from 'autotel-nuxt/runtime/nitro';

export default withAutotelEventHandler(async (event) => {
  useLogger(event).set({ feature: 'health' });
  return { ok: true };
});
```

The module initializes `autotel` once through its Nitro plugin. Configure the
service and OTLP destination with `OTEL_SERVICE_NAME` and
`OTEL_EXPORTER_OTLP_ENDPOINT`.

/**
 * Zero-config Autotel bootstrap for TanStack Start demo.
 *
 * We import this module from the router so tracing is initialized before any
 * loader/server function runs. The actual OpenTelemetry setup is delegated to
 * `autotel-tanstack/auto` which reads OTEL_* env vars.
 */

declare global {
  var __autotelInitPromise: Promise<void> | undefined
}

const serverDebug =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env.AUTOTEL_DEBUG === 'true'

const debugLogging = import.meta.env.DEV || serverDebug

async function ensureAutotelInitialized() {
  if (!import.meta.env.SSR) {
    if (debugLogging) {
      console.debug(
        '🔕 [autotel] Skipping server instrumentation in browser bundle',
      )
    }
    return
  }

  if (!globalThis.__autotelInitPromise) {
    globalThis.__autotelInitPromise = import('autotel-tanstack/auto')
      .then((mod) => {
        if (debugLogging) {
          const service = mod.getServiceName()
          const endpoint = mod.getEndpoint()
          console.log('🔭 [autotel] Zero-config instrumentation ready')
          console.log('🔭 [autotel] Service:', service)
          console.log(
            '🔭 [autotel] Endpoint:',
            endpoint ??
              'not configured (set OTEL_EXPORTER_OTLP_ENDPOINT to export traces)',
          )
        }
      })
      .catch((error) => {
        console.error('❌ [autotel] Failed to initialize tracing', error)
      })
  }

  await globalThis.__autotelInitPromise
}

void ensureAutotelInitialized()

export {}

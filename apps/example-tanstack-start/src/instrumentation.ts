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
    globalThis.__autotelInitPromise = Promise.all([
      import('autotel-tanstack'),
      import('@opentelemetry/instrumentation-undici'),
    ])
      .then(([{ instrument }, { UndiciInstrumentation }]) => {
        // `autotel-tanstack/auto` does everything below except register the
        // undici instrumentation. Without it, outgoing fetch() calls carry no
        // `traceparent` and downstream services start a new trace.
        // Undici's instrumentation hooks diagnostics_channel rather than
        // patching require(), so it works in the ESM server bundle with no loader.
        instrument({ instrumentations: [new UndiciInstrumentation()] })

        if (debugLogging) {
          console.log('🔭 [autotel] Instrumentation ready (+ outgoing fetch)')
          console.log(
            '🔭 [autotel] Service:',
            process.env.OTEL_SERVICE_NAME ?? 'tanstack-start',
          )
          console.log(
            '🔭 [autotel] Endpoint:',
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
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

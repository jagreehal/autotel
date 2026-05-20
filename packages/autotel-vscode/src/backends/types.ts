import type { TraceData } from 'autotel-devtools/server'

// A QueryAdapter knows how to talk to ONE specific OTel-compatible backend
// (Tempo, Jaeger, Honeycomb, Datadog, Logfire, Signoz/ClickHouse, …) and
// return traces in the same shape the rest of the extension consumes.
//
// Implementations should:
//  - Authenticate using credentials from `vscode.SecretStorage` (never settings).
//  - Honor `abortSignal` so the UI can cancel in-flight queries.
//  - Map backend-native span attributes to the OTel semconv this extension
//    expects (especially `gen_ai.*` for the GenAI view to keep working).

export interface QueryAdapterContext {
  baseUrl: string
  /** Optional dataset / project / scope ID required by some backends (Honeycomb dataset, Logfire project, …). */
  dataset?: string
  /** Read-only access to credentials. Adapters MUST NOT log secrets. */
  secrets: {
    get(key: string): Promise<string | undefined>
  }
  abortSignal: AbortSignal
  /** Optional per-call timeout in ms. Adapter respects this in addition to abortSignal. */
  timeoutMs?: number
}

/** Standard secret key per adapter id. Each adapter reads from this key only. */
export function credentialKey(adapterId: string): string {
  return `autotel.backend.${adapterId}.token`
}

export interface TraceQuery {
  /** Free-text search across span names / attributes (backend-interpreted). */
  text?: string
  /** Service name filter. */
  service?: string
  /** Earliest start time (epoch ms). */
  startMs?: number
  /** Latest start time (epoch ms). */
  endMs?: number
  /** Result cap. Default 100. */
  limit?: number
  /** Only return traces with at least one errored span. */
  errorsOnly?: boolean
}

export interface QueryAdapter {
  /** Unique adapter id, e.g. 'jaeger', 'tempo', 'honeycomb'. */
  readonly id: string
  /** Human-readable label for the picker. */
  readonly label: string

  /** Health check — returns true if the backend is reachable + auth works. */
  ping(ctx: QueryAdapterContext): Promise<boolean>

  /** List distinct service names. */
  listServices(ctx: QueryAdapterContext): Promise<string[]>

  /** Search traces matching the query. */
  searchTraces(ctx: QueryAdapterContext, query: TraceQuery): Promise<TraceData[]>

  /** Fetch a single trace by id. */
  getTrace(ctx: QueryAdapterContext, traceId: string): Promise<TraceData | undefined>
}

// Registry — adapters self-register by id. The picker reads from this map.
const REGISTRY = new Map<string, QueryAdapter>()

export function registerAdapter(adapter: QueryAdapter): void {
  REGISTRY.set(adapter.id, adapter)
}

export function getAdapter(id: string): QueryAdapter | undefined {
  return REGISTRY.get(id)
}

export function listAdapters(): QueryAdapter[] {
  return [...REGISTRY.values()]
}

// Eagerly load every adapter so they self-register. Adding a new backend
// is a one-import change here + a new file in this folder.
import './jaeger'
import './tempo'
import './honeycomb'
import './datadog'
import './logfire'
import './signoz'

export { getAdapter, listAdapters, registerAdapter, credentialKey } from './types'
export type { QueryAdapter, QueryAdapterContext, TraceQuery } from './types'

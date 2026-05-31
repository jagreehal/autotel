import { mountWidget } from './mount'
import { registerElement } from './element'
import cssText from './styles.css?inline'

// Capture script element synchronously — it's null after IIFE finishes
const _currentScript = document.currentScript as HTMLScriptElement | null

interface ScriptParams {
  mode: 'widget' | 'fullpage'
  wsUrl: string
  deepLink?: { traceId: string; spanId?: string }
}

// A deep-link is carried on the page URL hash (`#trace=<id>&span=<id>`) rather
// than the script src, so an embedder (e.g. the VS Code extension) can point an
// iframe at `/#trace=...` and have the widget open focused on that span.
function getDeepLink(): { traceId: string; spanId?: string } | undefined {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  if (!hash) return undefined
  const params = new URLSearchParams(hash)
  const traceId = params.get('trace')
  if (!traceId) return undefined
  return { traceId, spanId: params.get('span') || undefined }
}

function getScriptParams(): ScriptParams {
  const deepLink = getDeepLink()
  if (!_currentScript?.src) {
    return { mode: 'widget', wsUrl: `ws://${location.host}/ws`, deepLink }
  }

  const url = new URL(_currentScript.src)
  const params = url.searchParams
  const mode = (params.get('mode') || 'widget') as 'widget' | 'fullpage'
  const wsUrl = params.get('ws') || `ws://${url.host}/ws`

  return { mode, wsUrl, deepLink }
}

function init(): void {
  // Register custom element for programmatic use
  registerElement()

  // Auto-mount if no custom element is already on the page
  const existing = document.querySelector('autotel-devtools')
  if (existing) return

  const { mode, wsUrl, deepLink } = getScriptParams()

  const container = document.createElement('div')
  container.id = 'autotel-devtools-root'
  document.body.appendChild(container)

  const shadow = container.attachShadow({ mode: 'open' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = cssText
  shadow.appendChild(style)

  mountWidget(shadow, { mode, wsUrl, deepLink })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export { mountWidget } from './mount'
export { registerElement } from './element'

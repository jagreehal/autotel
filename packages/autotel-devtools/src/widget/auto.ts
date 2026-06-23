import { mountWidget } from './mount'
import { registerElement } from './element'
import { parseNavHash, type NavState } from './url-sync'
import cssText from './styles.css?inline'

// Capture script element synchronously — it's null after IIFE finishes
const _currentScript = document.currentScript as HTMLScriptElement | null

interface ScriptParams {
  mode: 'widget' | 'fullpage'
  wsUrl: string
  deepLink?: NavState
}

// Initial navigation is carried on the page URL hash
// (`#tab=<tab>&trace=<id>&span=<id>`) rather than the script src, so an embedder
// (e.g. the VS Code extension) can point an iframe at `/#trace=...` and have the
// widget open focused on that span — and so the full-page UI can be shared by
// copying its URL (see Widget.svelte for the write-back side).
function getDeepLink(): NavState | undefined {
  const nav = parseNavHash(location.hash)
  // Any meaningful field (tab, trace/span, or a filter) is worth restoring.
  return Object.keys(nav).length > 0 ? nav : undefined
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

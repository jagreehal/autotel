import { mountWidget } from './Widget'
import { registerElement } from './element'
import cssText from './styles.css?inline'

// Capture script element synchronously — it's null after IIFE finishes
const _currentScript = document.currentScript as HTMLScriptElement | null

function getScriptParams(): { mode: 'widget' | 'fullpage'; wsUrl: string; position?: string } {
  if (!_currentScript?.src) {
    return { mode: 'widget', wsUrl: `ws://${location.host}/ws` }
  }

  const url = new URL(_currentScript.src)
  const params = url.searchParams
  const mode = (params.get('mode') || 'widget') as 'widget' | 'fullpage'
  const wsUrl = params.get('ws') || `ws://${url.host}/ws`
  const position = params.get('position') || undefined

  return { mode, wsUrl, position }
}

function init(): void {
  // Register custom element for programmatic use
  registerElement()

  // Auto-mount if no custom element is already on the page
  const existing = document.querySelector('autotel-devtools')
  if (existing) return

  const { mode, wsUrl } = getScriptParams()

  const container = document.createElement('div')
  container.id = 'autotel-devtools-root'
  document.body.appendChild(container)

  const shadow = container.attachShadow({ mode: 'open' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = cssText
  shadow.appendChild(style)

  mountWidget(shadow, { mode, wsUrl })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export { mountWidget } from './Widget'
export { registerElement } from './element'

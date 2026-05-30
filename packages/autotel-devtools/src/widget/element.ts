import { mountWidget } from './mount'
import cssText from './styles.css?inline'

class AutotelDevtoolsElement extends HTMLElement {
  static observedAttributes = ['mode', 'ws-url']
  private cleanup: (() => void) | null = null

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' })

    // Inject Google Fonts (Hanken Grotesk for UI chrome, JetBrains Mono for
    // data) into the shadow root.
    const fontLink = document.createElement('link')
    fontLink.rel = 'stylesheet'
    fontLink.href =
      'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap'
    shadow.appendChild(fontLink)

    // Inject styles
    const style = document.createElement('style')
    style.textContent = cssText
    shadow.appendChild(style)

    const mode = (this.getAttribute('mode') || 'widget') as 'widget' | 'fullpage'
    const wsUrl = this.getAttribute('ws-url') || this.deriveWsUrl()

    this.cleanup = mountWidget(shadow, { mode, wsUrl })
  }

  disconnectedCallback() {
    this.cleanup?.()
    this.cleanup = null
  }

  private deriveWsUrl(): string {
    return `ws://${location.host}/ws`
  }
}

export function registerElement(): void {
  if (!customElements.get('autotel-devtools')) {
    customElements.define('autotel-devtools', AutotelDevtoolsElement)
  }
}

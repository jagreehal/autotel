/**
 * Framework mount boundary. Wraps Svelte's `mount`/`unmount` so the
 * shadow-DOM layer (`element.ts`, `auto.ts`) stays framework-agnostic — it just
 * calls `mountWidget(shadowRoot, props)` and gets a cleanup back, exactly as it
 * did with Preact's `render`.
 */
import { mount, unmount } from 'svelte'
import Widget from './Widget.svelte'
import { connectionStatusSignal } from './store.svelte'
import type { NavState } from './url-sync'

export { connectionStatusSignal }

export interface WidgetProps {
  mode: 'widget' | 'fullpage'
  wsUrl: string
  /**
   * Optional initial navigation from the URL hash: switch to `tab` immediately,
   * and select `trace`/`span` once the trace arrives over the wire.
   */
  deepLink?: NavState
}

export function mountWidget(
  container: HTMLElement | ShadowRoot,
  props: WidgetProps,
): () => void {
  const app = mount(Widget, { target: container, props })
  return () => {
    void unmount(app)
  }
}

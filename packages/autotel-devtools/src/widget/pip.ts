/**
 * Document Picture-in-Picture pop-out for the devtools panel.
 *
 * Rather than re-rendering the UI into a second window, we physically reparent
 * the widget's shadow host into the PiP window's document. Because the host is a
 * shadow root, all of its styles (the injected stylesheet + font link) travel
 * with the node, and the Svelte component stays mounted and reactive — the same
 * trick that lets the TanStack devtools pop out without losing state. A
 * placeholder comment marks the original position so we can slot it back.
 */

interface DocumentPiP {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>
}

function pipApi(): DocumentPiP | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture ?? null
}

export function isPipSupported(): boolean {
  return pipApi() !== null
}

let pipWindow: Window | null = null
let placeholder: Comment | null = null

export interface PipOptions {
  width?: number
  height?: number
}

/**
 * Pop `host` (the shadow host element) into a fresh PiP window. `onClose` runs
 * whenever the window goes away — whether the user closed it or we did — so the
 * caller can clear its `pipActive` state. Returns false if PiP is unsupported or
 * already open.
 */
export async function openPip(
  host: HTMLElement,
  onClose: () => void,
  { width = 720, height = 560 }: PipOptions = {},
): Promise<boolean> {
  const api = pipApi()
  if (!api || pipWindow) return false

  const win = await api.requestWindow({ width, height })
  pipWindow = win
  win.document.title = 'autotel devtools'

  const reset = win.document.createElement('style')
  reset.textContent =
    'html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden;background:transparent}'
  win.document.head.appendChild(reset)

  placeholder = host.ownerDocument.createComment('autotel-pip-placeholder')
  host.replaceWith(placeholder)
  win.document.body.appendChild(host)

  win.addEventListener('pagehide', () => restore(onClose), { once: true })
  return true
}

/** Reparent the host back to the page and close the PiP window. */
export function closePip(onClose?: () => void): void {
  if (!pipWindow) return
  const win = pipWindow
  restore(onClose)
  try {
    win.close()
  } catch {
    /* window already tearing down */
  }
}

function restore(onClose?: () => void): void {
  const win = pipWindow
  if (!win) return
  pipWindow = null
  const host = win.document.body.firstElementChild as HTMLElement | null
  if (host) {
    if (placeholder?.isConnected) placeholder.replaceWith(host)
    else document.body.appendChild(host)
  }
  placeholder = null
  onClose?.()
}

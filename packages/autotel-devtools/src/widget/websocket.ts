import type { DevtoolsData } from '../server/types'

export type MessageHandler = (data: DevtoolsData) => void
export type ConnectionStatus = 'connected' | 'disconnected'
export type StatusHandler = (status: ConnectionStatus) => void

export class DevtoolsWebSocketClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private reconnectAttempts = 0
  private closed = false
  private reconnectDelay = 1000
  // Never stop retrying: the server replays full history on reconnect, so a
  // widget that keeps trying self-heals after laptop sleep or a devtools
  // restart. Backoff is capped instead of attempt-limited.
  private maxReconnectDelay = 15_000

  constructor(private url: string) {}

  connect(): void {
    this.closed = false
    try {
      this.ws = new WebSocket(this.url)

      this.ws.addEventListener('open', () => {
        this.reconnectAttempts = 0
        this.emitStatus('connected')
      })

      this.ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data as string)
          for (const handler of this.messageHandlers) handler(data)
        } catch { /* ignore parse errors */ }
      })

      this.ws.addEventListener('close', () => {
        this.emitStatus('disconnected')
        this.scheduleReconnect()
      })
    } catch {
      this.emitStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    if (this.closed) return
    for (const handler of this.statusHandlers) handler(status)
  }

  private scheduleReconnect(): void {
    // An intentional disconnect() also fires 'close' on the old socket —
    // don't resurrect the connection it just tore down.
    if (this.closed) return
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  disconnect(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageHandlers.clear()
    this.statusHandlers.clear()
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

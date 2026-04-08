import type { DevtoolsData } from '../server/types'

export type MessageHandler = (data: DevtoolsData) => void

export class DevtoolsWebSocketClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000

  constructor(private url: string) {}

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.addEventListener('open', () => {
          this.reconnectAttempts = 0
          resolve(true)
        })

        this.ws.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data as string)
            for (const handler of this.messageHandlers) handler(data)
          } catch { /* ignore parse errors */ }
        })

        this.ws.addEventListener('close', () => {
          this.scheduleReconnect()
        })

        this.ws.addEventListener('error', () => {
          resolve(false)
        })
      } catch {
        resolve(false)
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageHandlers.clear()
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

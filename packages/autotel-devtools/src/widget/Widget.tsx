import { h, render } from 'preact'
import { useEffect } from 'preact/hooks'
import { DevtoolsWebSocketClient } from './websocket'
import { updateWidgetData, loadPersistedState, connectionStatusSignal } from './store'
import { Bubble } from './components/Bubble'
import { Panel } from './components/Panel'
import { Layout } from './components/Layout'

export { connectionStatusSignal }

interface WidgetProps {
  mode: 'widget' | 'fullpage'
  wsUrl: string
}

let wsClient: DevtoolsWebSocketClient | null = null

export function Widget({ mode, wsUrl }: WidgetProps) {
  useEffect(() => {
    loadPersistedState()

    wsClient = new DevtoolsWebSocketClient(wsUrl)
    connectionStatusSignal.value = 'connecting'

    wsClient.connect().then((connected) => {
      connectionStatusSignal.value = connected ? 'connected' : 'disconnected'
    })

    const unsubscribe = wsClient.onMessage((data) => {
      updateWidgetData(data)
      connectionStatusSignal.value = 'connected'
    })

    return () => {
      unsubscribe()
      wsClient?.disconnect()
      wsClient = null
    }
  }, [wsUrl])

  if (mode === 'fullpage') {
    return <Layout />
  }

  return (
    <>
      <Bubble />
      <Panel />
    </>
  )
}

export function mountWidget(container: HTMLElement | ShadowRoot, props: WidgetProps): () => void {
  render(h(Widget, props), container)
  return () => render(null, container)
}

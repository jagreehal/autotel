// src/widget/components/TabContainer.tsx
import { h } from 'preact'
import { selectedTabSignal, setSelectedTab } from '../store'
import { cn } from '../utils/cn'
import { TracesView } from './TracesView'
import { ResourcesView } from './ResourcesView'
import { ServiceMapView } from './ServiceMapView'
import { MetricsView } from './MetricsView'
import { LogsView } from './LogsView'
import { ErrorsView } from './ErrorsView'
import type { TabType } from '../types'
import { Database, Boxes, Network, BarChart, FileText, AlertTriangle } from 'lucide-preact'

const TABS: Array<{ id: TabType; label: string; icon: any }> = [
  { id: 'traces', label: 'Traces', icon: Database },
  { id: 'resources', label: 'Resources', icon: Boxes },
  { id: 'service-map', label: 'Service Map', icon: Network },
  { id: 'metrics', label: 'Metrics', icon: BarChart },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'errors', label: 'Errors', icon: AlertTriangle },
]

export function TabBar({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' }) {
  const selected = selectedTabSignal.value
  return (
    <nav className={cn(
      'flex gap-1 p-1',
      orientation === 'vertical' ? 'flex-col w-48 border-r border-zinc-200' : 'border-b border-zinc-200 overflow-x-auto',
    )}>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setSelectedTab(id)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap',
            selected === id ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900',
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </nav>
  )
}

export function TabContent() {
  const selected = selectedTabSignal.value
  switch (selected) {
    case 'traces': return <TracesView />
    case 'resources': return <ResourcesView />
    case 'service-map': return <ServiceMapView />
    case 'metrics': return <MetricsView />
    case 'logs': return <LogsView />
    case 'errors': return <ErrorsView />
    default: return <TracesView />
  }
}

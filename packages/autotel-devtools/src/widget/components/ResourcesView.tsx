import { h } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { Boxes } from 'lucide-preact'
import { resourceSummariesSignal } from '../store'
import { formatTimestamp } from '../utils'
import { cn } from '../utils/cn'
import type { ResourceHealth, ResourceSummary, ResourceType } from '../utils/resources'

const typeOptions: ResourceType[] = [
  'service',
  'database',
  'cache',
  'messaging',
  'external',
  'unknown',
]

function healthClass(health: ResourceHealth): string {
  switch (health) {
    case 'healthy':
      return 'bg-green-50 text-green-700 border-green-200'
    case 'degraded':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'unhealthy':
      return 'bg-red-50 text-red-700 border-red-200'
    default:
      return 'bg-gray-50 text-gray-600 border-gray-200'
  }
}

export function ResourcesView() {
  const resources = resourceSummariesSignal.value
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | ResourceType>('all')

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return resources.filter((resource) => {
      const matchesType = type === 'all' || resource.type === type
      const matchesQuery =
        normalizedQuery.length === 0 ||
        resource.name.toLowerCase().includes(normalizedQuery)
      return matchesType && matchesQuery
    })
  }, [resources, query, type])

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex flex-col gap-3 mb-4 pb-3 border-b border-gray-200">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-gray-900">
            <Boxes size={16} />
            Resources ({resources.length})
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onInput={(event) =>
              setQuery((event.currentTarget as HTMLInputElement).value)
            }
            placeholder="Filter resources"
            className="px-3 py-2 text-xs border border-gray-300 rounded-md min-w-[180px]"
          />
          <select
            value={type}
            onChange={(event) =>
              setType((event.currentTarget as HTMLSelectElement).value as 'all' | ResourceType)
            }
            className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white"
          >
            <option value="all">All types</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-12">
            No resources derived yet. Send traces or logs with resource metadata.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((resource) => (
              <ResourceRow key={resource.name} resource={resource} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ResourceRow({ resource }: { resource: ResourceSummary }) {
  return (
    <div className="border border-gray-200 rounded-md p-3 bg-white">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-medium text-gray-900">{resource.name}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">
            {resource.type}
          </div>
        </div>
        <span
          className={cn(
            'px-2 py-1 rounded border text-[11px] font-medium capitalize',
            healthClass(resource.health),
          )}
        >
          {resource.health}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-5">
        <Stat label="Requests" value={resource.requestCount} />
        <Stat label="Errors" value={resource.errorCount} />
        <Stat label="Traces" value={resource.traceCount} />
        <Stat label="Logs" value={resource.logCount} />
        <Stat
          label="Last Seen"
          value={resource.lastSeen ? formatTimestamp(resource.lastSeen) : 'n/a'}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="text-sm text-gray-800">{value}</div>
    </div>
  )
}

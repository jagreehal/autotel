/**
 * Metrics view - displays events, funnels, outcomes, and values
 */

import { h } from 'preact'
import { BarChart, TrendingUp, Target, DollarSign } from 'lucide-preact'
import { groupedMetricsSignal } from '../store'
import { formatNumber, formatTimestamp } from '../utils'
import { cn } from '../utils/cn'
import type { MetricData } from '../types'

export function MetricsView() {
  const metrics = groupedMetricsSignal.value

  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-gray-900">
          <BarChart size={16} />
          Metrics
        </h3>
      </div>

      {/* Metrics grid */}
      <div className="flex-1 overflow-auto space-y-4">
        {metrics.events.length === 0 &&
        metrics.funnels.length === 0 &&
        metrics.outcomes.length === 0 &&
        metrics.values.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-12">
            No metrics yet. Waiting for data...
          </div>
        ) : (
          <>
            {metrics.events.length > 0 && (
              <MetricSection
                title="Events"
                icon={<BarChart size={16} />}
                metrics={metrics.events}
              />
            )}

            {metrics.funnels.length > 0 && (
              <MetricSection
                title="Funnels"
                icon={<TrendingUp size={16} />}
                metrics={metrics.funnels}
              />
            )}

            {metrics.outcomes.length > 0 && (
              <MetricSection
                title="Outcomes"
                icon={<Target size={16} />}
                metrics={metrics.outcomes}
              />
            )}

            {metrics.values.length > 0 && (
              <MetricSection
                title="Values"
                icon={<DollarSign size={16} />}
                metrics={metrics.values}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface MetricSectionProps {
  title: string
  icon: any
  metrics: MetricData[]
}

function MetricSection({ title, icon, metrics }: MetricSectionProps) {
  return (
    <div className="border border-gray-200 rounded-md p-4 bg-white">
      <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-900">
        {icon}
        {title} ({metrics.length})
      </h4>

      <div className="space-y-2">
        {metrics.slice(0, 10).map((metric, idx) => (
          <MetricRow key={idx} metric={metric} />
        ))}

        {metrics.length > 10 && (
          <div className="text-xs text-gray-500 text-center pt-2 border-t border-gray-200">
            +{metrics.length - 10} more
          </div>
        )}
      </div>
    </div>
  )
}

interface MetricRowProps {
  metric: MetricData
}

function MetricRow({ metric }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-md text-sm border border-gray-200">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate text-gray-900">{metric.name}</div>
        {Object.keys(metric.attributes).length > 0 && (
          <div className="text-xs text-gray-600 mt-1.5 flex flex-wrap gap-2">
            {Object.entries(metric.attributes)
              .slice(0, 3)
              .map(([key, value]) => (
                <span key={key} className="font-mono">
                  {key}: {String(value)}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        {metric.value !== undefined && (
          <div className="font-semibold text-blue-600 text-sm">
            {formatNumber(metric.value)}
          </div>
        )}
        <div className="text-xs text-gray-500 mt-1">
          {formatTimestamp(metric.timestamp)}
        </div>
      </div>
    </div>
  )
}

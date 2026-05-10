import { h } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { Camera, Upload, X } from 'lucide-preact'
import {
  tracesSignal,
  logsSignal,
  errorGroupsSignal,
  metricsSignal,
  snapshotModeSignal,
  loadSnapshot,
  exitSnapshotMode,
} from '../store'
import {
  downloadSnapshotAsJson,
  importSnapshotFromFile,
} from '../export-import'
import { cn } from '../utils/cn'

export function SnapshotBar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const inSnapshot = snapshotModeSignal.value

  const onDownload = () => {
    setError(null)
    setWarning(null)
    downloadSnapshotAsJson({
      traces: tracesSignal.value,
      logs: logsSignal.value,
      errors: errorGroupsSignal.value,
      metrics: metricsSignal.value,
    })
  }

  const onPickFile = () => {
    fileInputRef.current?.click()
  }

  const onFileChange = async (event: Event) => {
    setError(null)
    setWarning(null)
    const target = event.currentTarget as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    if (!file) return
    const result = await importSnapshotFromFile(file)
    if (!result.success || !result.snapshot) {
      setError(result.errors.join('; ') || 'Failed to load snapshot')
      return
    }
    if (result.warnings.length > 0) {
      setWarning(result.warnings.join('; '))
    }
    loadSnapshot(result.snapshot)
  }

  return (
    <div
      className={cn(
        'border-b border-zinc-200 px-3 py-1.5 text-xs flex items-center gap-2',
        inSnapshot ? 'bg-amber-50 text-amber-900' : 'bg-zinc-50 text-zinc-700',
      )}
    >
      {inSnapshot ? (
        <>
          <Camera size={12} />
          <span className="font-medium">Snapshot mode</span>
          <span className="text-amber-700">— live updates paused.</span>
          <button
            onClick={exitSnapshotMode}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors"
            title="Exit snapshot and clear data"
          >
            <X size={12} />
            Exit
          </button>
        </>
      ) : (
        <>
          <span className="text-zinc-500">Local data</span>
          <button
            onClick={onDownload}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-200 transition-colors"
            title="Download a snapshot of traces, logs, errors and metrics"
          >
            <Camera size={12} />
            Download snapshot
          </button>
          <button
            onClick={onPickFile}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-200 transition-colors"
            title="Load a snapshot file"
          >
            <Upload size={12} />
            Load snapshot
          </button>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onFileChange}
      />
      {error && (
        <span className="text-red-600 truncate" title={error}>
          {error}
        </span>
      )}
      {warning && !error && (
        <span className="text-amber-700 truncate" title={warning}>
          {warning}
        </span>
      )}
    </div>
  )
}

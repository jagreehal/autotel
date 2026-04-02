/**
 * Copyable component - adds copy functionality to content
 */

import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Copy, Check } from 'lucide-preact'
import { cn } from '../utils/cn'

interface CopyableProps {
  content: string
  children: any
}

export function Copyable({ content, children }: CopyableProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <div className="relative group">
      {children}
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md",
          "bg-white border border-gray-300 shadow-sm",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "hover:bg-gray-50"
        )}
        title="Copy"
      >
        {copied ? (
          <Check size={14} className="text-green-600" />
        ) : (
          <Copy size={14} className="text-gray-600" />
        )}
      </button>
    </div>
  )
}

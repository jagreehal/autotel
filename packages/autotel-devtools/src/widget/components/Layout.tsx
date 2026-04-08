// src/widget/components/Layout.tsx
import { h } from 'preact'
import { TabBar, TabContent } from './TabContainer'

export function Layout() {
  return (
    <div className="flex h-screen w-screen bg-white text-gray-900">
      <div className="hidden md:flex">
        <TabBar orientation="vertical" />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden">
          <TabBar orientation="horizontal" />
        </div>
        <div className="flex-1 overflow-hidden">
          <TabContent />
        </div>
      </div>
    </div>
  )
}

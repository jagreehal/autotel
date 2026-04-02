/**
 * Expandable panel with tabs
 */

import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  X,
  Database,
  BarChart,
  AlertTriangle,
  Network,
  FileText,
} from 'lucide-preact';
import {
  widgetExpandedSignal,
  selectedTabSignal,
  popoverDimensionsSignal,
  totalErrorCountSignal,
  toggleWidget,
  setSelectedTab,
  setPopoverDimensions,
} from '../store';
import { clamp } from '../utils';
import { cn } from '../utils/cn';
import { TracesView } from './TracesView';
import { ServiceMapView } from './ServiceMapView';
import { MetricsView } from './MetricsView';
import { ErrorsView } from './ErrorsView';
import { LogsView } from './LogsView';
import type { TabType } from '../types';

export function Panel() {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 100, y: 100 });

  const expanded = widgetExpandedSignal.value;
  const selectedTab = selectedTabSignal.value;
  const dimensions = popoverDimensionsSignal.value;

  if (!expanded) {
    return null;
  }

  const totalErrors = totalErrorCountSignal.value;

  const tabs: Array<{ id: TabType; label: string; icon: any; badge?: number }> =
    [
      { id: 'traces', label: 'Traces', icon: Database },
      { id: 'service-map', label: 'Services', icon: Network },
      { id: 'metrics', label: 'Metrics', icon: BarChart },
      { id: 'logs', label: 'Logs', icon: FileText },
      {
        id: 'errors',
        label: 'Errors',
        icon: AlertTriangle,
        badge: totalErrors > 0 ? totalErrors : undefined,
      },
    ];

  const handleHeaderPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return; // Don't drag when clicking buttons

    isDragging.current = true;
    const rect = popoverRef.current?.getBoundingClientRect();
    if (rect) {
      dragStart.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (isDragging.current) {
      const newX = clamp(
        e.clientX - dragStart.current.x,
        0,
        window.innerWidth - dimensions.width,
      );
      const newY = clamp(
        e.clientY - dragStart.current.y,
        0,
        window.innerHeight - dimensions.height,
      );

      positionRef.current = { x: newX, y: newY };
      if (popoverRef.current) {
        popoverRef.current.style.left = `${newX}px`;
        popoverRef.current.style.top = `${newY}px`;
      }
    }

    if (isResizing.current) {
      const newWidth = clamp(
        e.clientX - positionRef.current.x,
        400,
        window.innerWidth - positionRef.current.x,
      );
      const newHeight = clamp(
        e.clientY - positionRef.current.y,
        300,
        window.innerHeight - positionRef.current.y,
      );

      setPopoverDimensions(newWidth, newHeight);
    }
  };

  const handlePointerUp = () => {
    isDragging.current = false;
    isResizing.current = false;
  };

  const handleResizePointerDown = (e: PointerEvent) => {
    e.stopPropagation();
    isResizing.current = true;
  };

  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove as any);
    document.addEventListener('pointerup', handlePointerUp as any);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove as any);
      document.removeEventListener('pointerup', handlePointerUp as any);
    };
  }, [dimensions]);

  // Center panel on first open
  useEffect(() => {
    if (expanded && popoverRef.current) {
      const x = (window.innerWidth - dimensions.width) / 2;
      const y = (window.innerHeight - dimensions.height) / 2;
      positionRef.current = { x, y };
      popoverRef.current.style.left = `${x}px`;
      popoverRef.current.style.top = `${y}px`;
    }
  }, [expanded]);

  const renderTabContent = () => {
    switch (selectedTab) {
      case 'traces': {
        return <TracesView />;
      }
      case 'service-map': {
        return <ServiceMapView />;
      }
      case 'metrics': {
        return <MetricsView />;
      }
      case 'logs': {
        return <LogsView />;
      }
      case 'errors': {
        return <ErrorsView />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={cn(
          'fixed inset-0 z-[999]',
          'bg-black/20 backdrop-blur-sm',
          'animate-fade-in',
        )}
        onClick={toggleWidget}
      />

      {/* Panel */}
      <div
        ref={popoverRef}
        className={cn(
          'fixed z-[1000]',
          'bg-white border border-zinc-200 rounded-lg',
          'shadow-2xl',
          'flex flex-col',
          'animate-fade-in',
        )}
        style={{
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          left: `${positionRef.current.x}px`,
          top: `${positionRef.current.y}px`,
        }}
      >
        {/* Close button in top-right corner */}
        <button
          onClick={toggleWidget}
          className={cn(
            'absolute top-2 right-2 z-10',
            'p-1.5 rounded-md',
            'bg-white border border-zinc-300 shadow-sm',
            'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50',
            'transition-colors',
          )}
          title="Close"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div
          className={cn(
            'flex items-center px-4 pt-3 pb-0',
            'border-b border-zinc-200',
            'cursor-grab',
          )}
          onPointerDown={handleHeaderPointerDown as any}
        >
          <div className="flex gap-6">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = selectedTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                  className={cn(
                    'text-sm font-medium pb-3 transition-colors relative cursor-pointer',
                    'flex items-center gap-2',
                    isActive
                      ? 'text-zinc-900'
                      : 'text-zinc-500 hover:text-zinc-700',
                  )}
                >
                  <Icon
                    size={16}
                    className={
                      tab.id === 'errors' && tab.badge
                        ? 'text-red-500'
                        : undefined
                    }
                  />
                  {tab.label}
                  {tab.badge && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">{renderTabContent()}</div>

        {/* Resize handle */}
        <div
          className={cn(
            'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize',
            'touch-none select-none',
          )}
          onPointerDown={handleResizePointerDown as any}
        >
          <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-zinc-400" />
        </div>
      </div>
    </>
  );
}

import React, { createContext, useContext, useState } from 'react'
import { cn } from '../../lib/cn'

type TabsCtx = { value: string; setValue: (v: string) => void }

const TabsContext = createContext<TabsCtx | null>(null)

export type TabsProps = {
  defaultValue: string
  className?: string
  children: React.ReactNode
}

export function Tabs({ defaultValue, className, children }: TabsProps) {
  const [value, setValue] = useState(defaultValue)
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex gap-1 rounded-full bg-[#D6D0C8] p-1 ring-1 ring-black/8',
        className,
      )}
      {...props}
    />
  )
}

export type TabsTriggerProps = {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('TabsTrigger must be inside Tabs')
  const selected = ctx.value === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        'rounded-full px-3.5 py-1.5 text-sm font-medium transition-all',
        selected
          ? 'bg-[#F5EDE0] text-ink shadow-sm ring-1 ring-black/6'
          : 'text-ink/55 hover:text-ink/75',
        className,
      )}
      onClick={() => ctx.setValue(value)}
    >
      {children}
    </button>
  )
}

export type TabsContentProps = {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('TabsContent must be inside Tabs')
  if (ctx.value !== value) return null
  return (
    <div role="tabpanel" className={cn('mt-3 text-sm text-gray-700', className)}>
      {children}
    </div>
  )
}

"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/shared/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn(className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-elevation="control"
      className={cn(
        "inline-flex min-h-9 w-fit max-w-full flex-wrap items-center justify-center rounded-xl bg-surface p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(({ className, children, count, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    data-elevation="control-active"
    className={cn(
      "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-xl px-3 py-1 text-sm font-medium text-foreground/75 ring-offset-background transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "data-[state=active]:bg-surface-elevated data-[state=active]:text-foreground hover:bg-surface-hover hover:text-foreground",
      className
    )}
    {...props}
  >
    {children}
    {count !== undefined && count > 0 ? (
      <span data-slot="tabs-count" className="ms-1.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
        {count}
      </span>
    ) : null}
  </TabsPrimitive.Trigger>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

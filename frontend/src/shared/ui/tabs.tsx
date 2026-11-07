"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { useMobileClickActivation } from "@/shared/hooks/useMouseDownPress"
import { cn } from "@/shared/lib/utils"
import { Skeleton } from "@/shared/ui/skeleton"

/**
 * The active tab's pill renders inside the active trigger, so the server's
 * HTML already shows it. When the selection moves, the new pill starts where
 * the old trigger sat and slides into place: each tab set remembers its last
 * active trigger to know where that was.
 */
interface ActiveTab {
  value: string | undefined
  /** Called by the newly active trigger once its pill is in place. */
  moveIndicator: (indicator: HTMLElement, trigger: HTMLElement) => void
}

const ActiveTabContext = React.createContext<ActiveTab | null>(null)

const INDICATOR_SLIDE = { duration: 250, easing: "cubic-bezier(0.65, 0, 0.35, 1)" } as const

/** Slides `indicator` from where `from` sat to its own place (FLIP), correcting its corners while scaled. */
function slideIndicator(indicator: HTMLElement, from: HTMLElement, to: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const scaleX = from.offsetWidth / to.offsetWidth
  const scaleY = from.offsetHeight / to.offsetHeight
  const radius = parseFloat(getComputedStyle(indicator).borderTopLeftRadius) || 0
  indicator.animate(
    [
      {
        transform: `translate(${from.offsetLeft - to.offsetLeft}px, ${from.offsetTop - to.offsetTop}px) scale(${scaleX}, ${scaleY})`,
        borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`,
      },
      { transform: "none", borderRadius: `${radius}px` },
    ],
    INDICATOR_SLIDE,
  )
}

function Tabs({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const activeValue = value ?? uncontrolledValue
  const lastTrigger = React.useRef<HTMLElement | null>(null)
  const moveIndicator = React.useCallback((indicator: HTMLElement, trigger: HTMLElement) => {
    const previous = lastTrigger.current
    lastTrigger.current = trigger
    if (previous && previous !== trigger && previous.isConnected) {
      slideIndicator(indicator, previous, trigger)
    }
  }, [])
  const activeTab = React.useMemo(
    () => ({ value: activeValue, moveIndicator }),
    [activeValue, moveIndicator],
  )

  return (
    <ActiveTabContext.Provider value={activeTab}>
      <TabsPrimitive.Root
        data-slot="tabs"
        className={cn(className)}
        value={activeValue}
        onValueChange={(next) => {
          setUncontrolledValue(next)
          onValueChange?.(next)
        }}
        {...props}
      />
    </ActiveTabContext.Provider>
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
>(({ className, children, count, value, onMouseDown, onClick, ...props }, ref) => {
  const preferClick = useMobileClickActivation()
  const activeTab = React.useContext(ActiveTabContext)
  const isActive = activeTab?.value === value
  const indicatorRef = React.useRef<HTMLSpanElement>(null)

  const moveIndicator = activeTab?.moveIndicator

  React.useLayoutEffect(() => {
    const indicator = indicatorRef.current
    const trigger = indicator?.parentElement
    if (isActive && moveIndicator && indicator && trigger) moveIndicator(indicator, trigger)
  }, [isActive, moveIndicator])

  return (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    value={value}
    onMouseDown={event => {
      onMouseDown?.(event)
      if (preferClick || event.currentTarget.closest('[data-activation="click"]')) event.preventDefault()
    }}
    onClick={event => {
      onClick?.(event)
      if ((preferClick || event.currentTarget.closest('[data-activation="click"]')) && !event.defaultPrevented) {
        event.currentTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
      }
    }}
    className={cn(
      "relative isolate inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-xl px-3 py-1 text-sm font-medium text-foreground/75 ring-offset-background transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "data-[state=active]:text-foreground data-[state=inactive]:hover:bg-surface-hover hover:text-foreground",
      className
    )}
    {...props}
  >
    {isActive ? (
      <span
        ref={indicatorRef}
        data-elevation="control"
        className="absolute inset-0 -z-10 origin-top-left rounded-xl bg-surface-elevated"
      />
    ) : null}
    {children}
    {count !== undefined && count > 0 ? (
      <span data-slot="tabs-count" className="ms-1.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
        {count}
      </span>
    ) : null}
  </TabsPrimitive.Trigger>
)
})
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

/** A TabsList's frame with placeholder triggers, for tabs whose labels are not known yet. */
function TabsListSkeleton({ count }: { count: number }) {
  return (
    <div data-slot="tabs-list-skeleton" data-elevation="control" aria-hidden="true" className="inline-flex min-h-9 w-fit gap-1 rounded-xl bg-surface p-1">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={cn("h-7 rounded-xl", index === 0 ? "w-20" : "w-24")} />
      ))}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsListSkeleton }

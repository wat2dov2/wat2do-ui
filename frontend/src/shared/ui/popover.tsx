import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { useDrawerPortalContainer } from "@/shared/ui/drawer-portal-context"
import { cn } from "@/shared/lib/utils"
import { useExclusiveDisclosure } from "@/shared/hooks/useExclusiveDisclosure"
import { createAdaptivePressHandlers } from "@/shared/hooks/useMouseDownPress"

const PopoverDisclosureContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
} | null>(null)

function Popover({
  open, defaultOpen, onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [exclusiveOpen, setOpen] = useExclusiveDisclosure({ open, defaultOpen, onOpenChange })
  return (
    <PopoverDisclosureContext.Provider value={{ open: exclusiveOpen, setOpen }}>
      <PopoverPrimitive.Root data-slot="popover" open={exclusiveOpen} onOpenChange={setOpen} {...props} />
    </PopoverDisclosureContext.Provider>
  )
}

function PopoverTrigger({
  activation = "press",
  onMouseDown,
  onClick,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger> & { activation?: "press" | "click" }) {
  const disclosure = React.useContext(PopoverDisclosureContext)
  if (activation === "click") {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" data-activation="click" disabled={disabled} {...props} onClick={onClick} onMouseDown={onMouseDown}>{children}</PopoverPrimitive.Trigger>
  }
  const pressHandlers = createAdaptivePressHandlers({
    disabled,
    onMouseDown,
    onClick: (event) => {
      onClick?.(event as React.MouseEvent<HTMLButtonElement>)
      if (!event.defaultPrevented) disclosure?.setOpen(!disclosure.open)
      // The shared press handler owns toggling, including keyboard and touch.
      event.preventDefault()
    },
  })
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" disabled={disabled} {...props} {...pressHandlers}>{children}</PopoverPrimitive.Trigger>
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  variant = "default",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** `panel`: a header and a list that scrolls on its own, edge to edge (the notification inbox). */
  variant?: "default" | "menu" | "panel"
}) {
  // Inside a drawer, portal into the drawer instead of the document body, or
  // the drawer's scroll lock leaves this content unscrollable.
  const container = useDrawerPortalContainer()

  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-surface text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-toast w-72 origin-(--radix-popover-content-transform-origin) rounded-xl border p-4 shadow-lg outline-hidden",
          variant === "menu" && "w-48 p-1",
          variant === "panel" &&
            "flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/** The title row of a `panel` popover. */
function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("shrink-0 border-b border-border px-4 py-3 text-sm font-semibold", className)}
      {...props}
    />
  )
}

/** What a `panel` popover lists, scrolling on its own below the header. */
function PopoverBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-body"
      className={cn("min-h-0 overflow-y-auto p-1", className)}
      {...props}
    />
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverBody, PopoverAnchor }

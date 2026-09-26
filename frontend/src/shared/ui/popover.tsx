import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { useDrawerPortalContainer } from "@/shared/ui/drawer"
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
  onMouseDown,
  onClick,
  disabled,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const disclosure = React.useContext(PopoverDisclosureContext)
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
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" disabled={disabled} {...props} {...pressHandlers} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  variant = "default",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  variant?: "default" | "menu"
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
          "bg-surface-elevated text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-toast w-72 origin-(--radix-popover-content-transform-origin) rounded-xl border p-4 shadow-lg outline-hidden",
          variant === "menu" && "w-48 p-1",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }

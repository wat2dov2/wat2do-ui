import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/shared/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        "z-toast origin-(--radix-tooltip-content-transform-origin) overflow-hidden rounded-xl bg-surface-elevated px-3 py-1.5 text-xs text-foreground border border-border shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/** How long a tooltip shown by a tap or click stays up before it hides on its own. */
const TAP_TOOLTIP_MS = 2000

interface TapTooltipProps {
  /** What the trigger means. */
  content: React.ReactNode
  /** The trigger: one button, which a tap, click, Enter or Space presses. */
  children: React.ReactElement
}

/**
 * A tooltip that a tap shows too, since a touch screen cannot hover.
 *
 * Hover and keyboard focus show it like any tooltip. A tap or click shows it for
 * a moment, then it hides on its own. Pressing the trigger never also presses
 * what holds it, such as an event card: the mouse press and Enter or Space stop
 * at the trigger, and its click is prevented. The click itself still bubbles, so
 * an open tooltip or menu elsewhere sees it and closes; cards already leave clicks
 * on their own buttons alone.
 */
function TapTooltip({ content, children }: TapTooltipProps) {
  const [open, setOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const hideTimer = React.useRef<number | undefined>(undefined)
  // Radix closes a tooltip as its trigger is pressed; this press shows it instead, so the
  // close Radix asks for during the press is ignored rather than flickering the tooltip.
  const pressing = React.useRef(false)

  React.useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const changeOpen = (next: boolean) => {
    if (!next && pressing.current) return
    window.clearTimeout(hideTimer.current)
    setOpen(next)
  }

  return (
    <Tooltip open={open} onOpenChange={changeOpen}>
      <TooltipTrigger
        asChild
        ref={trigger}
        onPointerDown={() => {
          pressing.current = true
          queueMicrotask(() => { pressing.current = false })
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation()
        }}
        onClick={(event) => {
          // Prevented, so Radix does not close it again and an enclosing link does not follow.
          event.preventDefault()
          window.clearTimeout(hideTimer.current)
          setOpen(true)
          hideTimer.current = window.setTimeout(() => setOpen(false), TAP_TOOLTIP_MS)
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        onPointerDownOutside={(event) => {
          // Pressing the trigger again shows the tooltip again; it is not a press outside.
          if (event.target instanceof Node && trigger.current?.contains(event.target)) event.preventDefault()
        }}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TapTooltip }

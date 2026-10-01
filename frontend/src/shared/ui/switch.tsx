"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { createAdaptivePressHandlers } from "@/shared/hooks/useMouseDownPress"
import { cn } from "@/shared/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, disabled, onClick, onMouseDown, ...props }, ref) => {
  const handlers = createAdaptivePressHandlers({
    nativeActivation: true,
    disabled,
    onClick: onClick ? event => onClick(event as React.MouseEvent<HTMLButtonElement>) : undefined,
    onMouseDown: onMouseDown ? event => onMouseDown(event as React.MouseEvent<HTMLButtonElement>) : undefined,
  })
  return (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted",
      className
    )}
    {...props}
    {...handlers}
    disabled={disabled}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
)
})
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

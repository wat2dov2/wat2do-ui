import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { Check } from "@/shared/ui/doodle-icons"
import { cn } from "@/shared/lib/utils"

/**
 * `data-selected` marks a toggleable button that is currently "on". Selected
 * styling is defined once per variant here so no call site hand-rolls it.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-active data-[selected=true]:bg-selected data-[selected=true]:text-selected-foreground data-[selected=true]:shadow-[inset_0_0_0_1px_var(--selected-border)] data-[selected=true]:hover:bg-selected-hover",
        ghost:
          "bg-transparent text-foreground hover:bg-surface-hover active:bg-surface-active data-[selected=true]:bg-selected data-[selected=true]:text-selected-foreground data-[selected=true]:hover:bg-selected-hover",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active focus-visible:ring-destructive/20",
        warning:
          "bg-warning text-warning-foreground hover:bg-warning-hover active:bg-warning-active focus-visible:ring-warning/20",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

/** Icon-only sizes have no room for the trailing check glyph. */
const ICON_ONLY_SIZES = new Set(["icon", "icon-sm", "icon-lg"])

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
      /**
       * Marks a toggleable button as "on": applies the selected styling for the
       * variant, exposes `aria-pressed`, and appends a check glyph on sizes that
       * have room for one.
       */
      selected?: boolean
      "data-slot"?: string
    }
>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      selected,
      children,
      onClick,
      onMouseDown,
      onPointerDown,
      disabled,
      type = "button",
      "data-slot": dataSlot = "button",
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button"
    const showSelectedCheck =
      Boolean(selected) && !asChild && !ICON_ONLY_SIZES.has(size ?? "default")
    // A ghost button has no fill, so it has nothing to raise off the page and
    // the control shadow reads as a shadow cast by nothing. Every other variant
    // paints a surface and keeps it.
    const elevation = variant === "ghost" ? undefined : "control"

    return (
      <Comp
        ref={ref}
        data-slot={dataSlot}
        data-elevation={elevation}
        data-selected={selected === undefined ? undefined : selected}
        aria-pressed={selected}
        type={asChild ? undefined : type}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onPointerDown={onPointerDown}
        {...props}
      >
        {showSelectedCheck ? (
          <>
            {children}
            <Check aria-hidden="true" />
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)

Button.displayName = "Button"

export { Button, buttonVariants }

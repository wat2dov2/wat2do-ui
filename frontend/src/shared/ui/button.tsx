import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-normal transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-secondary hover:text-muted-foreground dark:bg-input/30 dark:border-input dark:hover:bg-secondary/60",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted/60",
        selected:
          "bg-slate-600 text-white hover:bg-slate-600/90 dark:bg-[#e7e5e4] dark:text-[#1c1917] dark:hover:bg-[#e7e5e4]",
        ghost:
          "bg-transparent text-foreground hover:bg-secondary dark:hover:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
      "data-slot"?: string
    }
>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
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

    return (
      <Comp
        ref={ref}
        data-slot={dataSlot}
        data-elevation="control"
        type={asChild ? undefined : type}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onPointerDown={onPointerDown}
        {...props}
      />
    )
  },
)

Button.displayName = "Button"

export { Button, buttonVariants }

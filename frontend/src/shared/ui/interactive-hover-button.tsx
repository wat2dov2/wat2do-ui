import * as React from "react"
import { ArrowRight } from "@/shared/ui/doodle-icons"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"

const interactiveHoverButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-normal transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] relative overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-secondary hover:text-muted-foreground dark:bg-input/30 dark:border-input dark:hover:bg-secondary/60",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-secondary hover:text-muted-foreground dark:hover:bg-secondary/60",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      // Don't set default size - let className determine height/padding
    },
  }
)

interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof interactiveHoverButtonVariants> {
  hideDot?: boolean;
}

export const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(({
  children,
  className,
  variant,
  size,
  hideDot = false,
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      data-elevation="control"
      className={cn("interactive-hover-button", interactiveHoverButtonVariants({ variant, size, className }))}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-1.5 transition-all duration-300 [.interactive-hover-button:hover_&]:translate-x-12 [.interactive-hover-button:hover_&]:opacity-0">
        {!hideDot && (
          <div className="bg-primary size-2 rounded-full transition-all duration-300 [.interactive-hover-button:hover_&]:scale-[100.8] shrink-0" />
        )}
        {children}
      </span>
      
      <span className="absolute inset-0 inline-flex translate-x-12 items-center justify-center gap-1.5 opacity-0 transition-all duration-300 [.interactive-hover-button:hover_&]:translate-x-0 [.interactive-hover-button:hover_&]:opacity-100">
        {children}
        <ArrowRight className="size-4 shrink-0" />
      </span>
    </button>
  )
})

InteractiveHoverButton.displayName = "InteractiveHoverButton"

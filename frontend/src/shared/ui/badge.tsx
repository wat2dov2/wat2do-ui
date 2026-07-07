import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/shared/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center border focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-foreground text-background hover:bg-foreground/85",
        secondary:
          "border-transparent bg-secondary text-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-error text-error-foreground hover:bg-error/80",
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80",
        warning:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/90",
        outline: "text-foreground",
        live:
          "border-0 bg-error text-error-foreground hover:bg-error/80 animate-pulse-live",
        soon:
          "border-0 bg-warning text-warning-foreground hover:bg-warning/80",
        new:
          "border-0 bg-blue-500 text-white hover:bg-blue-500/80",
      },
      size: {
        sm: "px-1.5 py-px text-[9px] font-medium rounded-lg",
        md: "px-2 py-0.5 text-[11px] font-bold rounded-xl",
        lg: "px-2.5 py-1 text-xs font-bold rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

const Badge = React.forwardRef<
  HTMLDivElement,
  BadgeProps
>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "div"
  return (
    <Comp
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
})
Badge.displayName = "Badge"

export { Badge }

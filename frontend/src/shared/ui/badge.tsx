import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/shared/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive-hover",
        outline:
          "border-border text-foreground",
        live:
          "border-0 bg-destructive text-destructive-foreground uppercase hover:bg-destructive-hover animate-pulse-live",
        soon:
          "border-0 bg-warning text-warning-foreground",
        new:
          "border-0 bg-primary text-primary-foreground hover:bg-primary-hover",
      },
      size: {
        sm: "px-1.5 py-px text-[9px] font-medium rounded-lg",
        md: "px-2 py-0.5 text-[11px] font-bold rounded-xl",
        lg: "px-2.5 py-1 text-xs font-bold rounded-xl",
        xl: "px-3 py-1.5 text-sm font-bold rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

interface BadgeProps
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

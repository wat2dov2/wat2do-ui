import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"

const badgeVariants = cva(
  "items-center rounded-xl border px-1 py-0 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2",
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
          "border-transparent bg-error text-error-foreground hover:bg-error/80 animate-pulse",
        soon:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/80",
        new:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants }

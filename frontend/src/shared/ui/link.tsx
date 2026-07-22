import NextLink from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/shared/lib/utils"

const linkVariants = cva("transition-colors", {
  variants: {
    variant: {
      default: "text-primary underline-offset-4 hover:underline",
      muted:
        "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

type LinkProps = ComponentProps<typeof NextLink> &
  VariantProps<typeof linkVariants>

function Link({ className, variant, ...props }: LinkProps) {
  return (
    <NextLink
      data-slot="link"
      className={cn(linkVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Link }
export type { LinkProps }

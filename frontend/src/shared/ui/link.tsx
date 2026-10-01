"use client"

import NextLink from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { createAdaptivePressHandlers } from "@/shared/hooks/useMouseDownPress"
import { cn } from "@/shared/lib/utils"

const linkVariants = cva("transition-colors", {
  variants: {
    variant: {
      navigation: "text-inherit",
      default: "text-primary underline-offset-4 hover:underline",
      muted:
        "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      announcement:
        "font-semibold text-foreground underline underline-offset-4 hover:text-primary",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

type LinkProps = ComponentProps<typeof NextLink> &
  VariantProps<typeof linkVariants>

function Link({ className, variant, onClick, onMouseDown, ...props }: LinkProps) {
  const handlers = createAdaptivePressHandlers({
    nativeActivation: true,
    onClick: onClick ? event => onClick(event as React.MouseEvent<HTMLAnchorElement>) : undefined,
    onMouseDown: onMouseDown ? event => onMouseDown(event as React.MouseEvent<HTMLAnchorElement>) : undefined,
  })
  return (
    <NextLink
      data-slot="link"
      className={cn(linkVariants({ variant, className }))}
      {...props}
      {...handlers}
    />
  )
}

export { Link }
export type { LinkProps }

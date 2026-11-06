import * as React from "react"

import { cn } from "@/shared/lib/utils"

const containerSizes = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  full: "max-w-none",
} as const

type ContainerSize = keyof typeof containerSizes

type ContainerProps = React.ComponentProps<"div"> & {
  size?: ContainerSize
}

/**
 * The one width owner for a page: its header and its content share this width,
 * so a back button and title always line up with the content below them.
 * Content never caps or centres itself. A step whose content is naturally
 * narrow (an upload card, a confirmation) marks itself
 * `data-content-width="sm"`, and the whole page, header included, narrows to
 * the small width while it is shown.
 */
function Container({ size = "lg", className, ...props }: ContainerProps) {
  return (
    <div
      data-slot="container"
      className={cn(
        "mx-auto w-full",
        containerSizes[size],
        "has-[[data-content-width=sm]]:max-w-2xl",
        className,
      )}
      {...props}
    />
  )
}

export { Container }
export type { ContainerProps, ContainerSize }

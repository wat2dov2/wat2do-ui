import * as React from "react"

import { cn } from "@/shared/lib/utils"

type PageBleedProps = React.ComponentProps<"div"> & {
  /**
   * The band starts at the very top of the page, under the navigation, which
   * stays see-through over it until the band scrolls away (`TopNav`).
   */
  underNav?: boolean
}

/**
 * A band that runs edge to edge across the viewport, out of PageFrame's side
 * gutter and any Container around it, centred on the page whatever their
 * widths.
 */
function PageBleed({ underNav = false, className, ...props }: PageBleedProps) {
  return (
    <div
      data-slot="page-bleed"
      data-under-nav={underNav ? true : undefined}
      className={cn("relative left-1/2 w-dvw -translate-x-1/2", className)}
      {...props}
    />
  )
}

export { PageBleed }
export type { PageBleedProps }

import * as React from "react"

import { cn } from "@/shared/lib/utils"

type PageFrameProps = React.ComponentProps<"div">

/**
 * Canonical outer gutter for every application page.
 *
 * Width constraints belong to Container. PageFrame owns only the shared page
 * padding so feature pages never select their own outer margin or padding.
 * A viewport layout fills the available height and contains its own scrolling.
 */
function PageFrame({ className, ...props }: PageFrameProps) {
  return (
    <div
      data-slot="page-frame"
      className={cn("overscroll-y-none w-full px-2 pt-4 pb-8 sm:p-4 sm:pb-8 has-[[data-slot=page-header][data-variant=listing]]:pt-0 has-[[data-page-layout=viewport]]:overflow-y-hidden has-[[data-page-layout=viewport]]:pb-2 [&>[data-page-layout=viewport]]:h-full [&>[data-page-layout=viewport]]:min-h-0", className)}
      {...props}
    />
  )
}

export { PageFrame }
export type { PageFrameProps }

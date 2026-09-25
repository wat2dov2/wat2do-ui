import * as React from "react"

import { cn } from "@/shared/lib/utils"

type PageFrameProps = React.ComponentProps<"div">

/**
 * Canonical outer gutter for every application page.
 *
 * Width constraints belong to Container. PageFrame owns only the shared page
 * padding so feature pages never select their own outer margin or padding.
 */
function PageFrame({ className, ...props }: PageFrameProps) {
  return (
    <div
      data-slot="page-frame"
      className={cn("overscroll-y-none w-full px-2 pt-4 pb-8 sm:p-4 sm:pb-8 has-[[data-slot=page-header][data-variant=listing]]:pt-0", className)}
      {...props}
    />
  )
}

export { PageFrame }
export type { PageFrameProps }

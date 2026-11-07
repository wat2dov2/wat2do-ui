import * as React from "react"

import { cn } from "@/shared/lib/utils"

type PageFrameProps = React.ComponentProps<"div"> & {
  /** Closes scrolling pages, always starting below the first screen. */
  footer?: React.ReactNode
}

/**
 * Canonical outer gutter for every application page.
 *
 * Width constraints belong to Container. PageFrame owns only the shared page
 * padding so feature pages never select their own outer margin or padding,
 * including the breathing room between the fixed navigation and the first
 * thing on the page.
 * Outside a viewport layout its padding never depends on what the page renders, so content never moves
 * when a loading state gives way to the page.
 * The page's content fills at least the frame's height, so the footer never
 * shows on the first screen while a page loads and then jumps away when the
 * content arrives.
 * A viewport layout fills the available height and contains its own scrolling,
 * so the footer is hidden beside it.
 */
function PageFrame({ className, children, footer, ...props }: PageFrameProps) {
  return (
    <div
      data-slot="page-frame"
      className={cn("overscroll-y-none w-full px-2 pt-8 pb-8 sm:px-4 sm:pt-12 sm:pb-8 has-[[data-page-layout=viewport]]:pt-0 has-[[data-page-layout=viewport]]:overflow-y-hidden has-[[data-page-layout=viewport]]:pb-2 has-[[data-page-layout=viewport]]:[&>[data-slot=site-footer]]:hidden", className)}
      {...props}
    >
      <div data-slot="page-content" className="min-h-full has-[>[data-page-layout=viewport]]:h-full [&>[data-page-layout=viewport]]:h-full [&>[data-page-layout=viewport]]:min-h-0">
        {children}
      </div>
      {footer}
    </div>
  )
}

export { PageFrame }
export type { PageFrameProps }

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
 * A page with a listing header drops the top padding: the sticky header sits flush
 * under the navigation. Loading states render the same listing header, so the
 * padding is the same before and after the page's data arrives.
 * The page's content fills at least the frame's height, so the footer never
 * shows on the first screen while a page loads and then jumps away when the
 * content arrives.
 * A band under the navigation (`PageBleed underNav`) starts the page at its
 * very top, so the frame drops its top padding beside it.
 * The site footer is a band of its own, so it closes the frame with no padding below it.
 * A viewport layout fills the available height and contains its own scrolling,
 * so the footer is hidden beside it.
 */
function PageFrame({ className, children, footer, ...props }: PageFrameProps) {
  return (
    <div
      data-slot="page-frame"
      className={cn("overscroll-y-none w-full px-2 pt-8 pb-8 sm:px-4 sm:pt-12 sm:pb-8 has-[[data-slot=page-header][data-variant=listing]]:pt-0 has-[[data-page-layout=viewport]]:pt-0 has-[[data-under-nav]]:pt-0 has-[>[data-slot=site-footer]]:not-has-[[data-page-layout=viewport]]:pb-0 has-[[data-page-layout=viewport]]:overflow-y-hidden has-[[data-page-layout=viewport]]:pb-2 has-[[data-page-layout=viewport]]:[&>[data-slot=site-footer]]:hidden", className)}
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

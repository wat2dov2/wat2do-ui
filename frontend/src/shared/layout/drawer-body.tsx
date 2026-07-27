import * as React from "react"

import { cn } from "@/shared/lib/utils"

type DrawerBodyProps = React.ComponentProps<"div">

/**
 * Scrollable region between a drawer's header and footer.
 *
 * DrawerContent is a height-capped flex column, so the body owns the overflow:
 * `min-h-0` lets it shrink below its content inside that column, `flex-auto`
 * lets its content establish the drawer's natural height before shrinking, and
 * the scroll stays inside the drawer instead of chaining to the page behind it.
 * Vaul owns touch gesture arbitration and detects this scrollable ancestor.
 */
function DrawerBody({ className, ...props }: DrawerBodyProps) {
  return (
    <div
      data-slot="drawer-body"
      className={cn(
        "flex min-h-0 flex-auto flex-col gap-6 overflow-y-auto overscroll-contain p-4 sm:p-6",
        className
      )}
      {...props}
    />
  )
}

export { DrawerBody }
export type { DrawerBodyProps }

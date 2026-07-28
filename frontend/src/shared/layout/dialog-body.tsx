import * as React from "react"

import { cn } from "@/shared/lib/utils"

type DialogBodyProps = React.ComponentProps<"div">

/**
 * Scroll owner for height-capped dialogs.
 *
 * DialogContent supplies the capped flex column. DialogBody shrinks inside it
 * and keeps scrolling within the overlay instead of chaining to the page.
 */
function DialogBody({ className, ...props }: DialogBodyProps) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "min-h-0 flex-auto overflow-y-auto overscroll-contain",
        className
      )}
      {...props}
    />
  )
}

export { DialogBody }
export type { DialogBodyProps }
